/// <reference types="spotify-api" />

import * as buffer from 'buffer';
import express from 'express';
import fetch from 'node-fetch';
import open from 'open';
import * as url from 'url';

import { TypedEmitter } from 'tiny-typed-emitter';
import spotify from 'spotify-web-api-node';

import { logger } from '../utils';

////////////////////////////////////////////////////////////
/// INTERFACES

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#time-interval-object
export interface TimeInterval {
  start: number;
  duration: number;
  confidence: number;
}

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#section-object
export interface Section extends TimeInterval {
  loudness: number;
  tempo: number;
  tempo_confidence: number;
  key: number;
  key_confidence: number;
  mode: number;
  mode_confidence: number;
  time_signature: number;
  time_signature_confidence: number;
}

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#segment-object
export interface Segment extends TimeInterval {
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  loudness_end: number;
  pitches: number[];
  timbre: number[];
}

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#audio-analysis-object
export interface AudioAnalysis {
  bars: TimeInterval[];
  beats: TimeInterval[];
  sections: Section[];
  segments: Segment[];
  tatums: TimeInterval[];
}

type AudioAnalysisWithInterval = {
  [key in keyof AudioAnalysis]: {
    activeIndex: number;
    intervals: AudioAnalysis[key];
    nextIntervalTimeout: NodeJS.Timeout | null;
  };
};

////////////////////////////////////////////////////////////
/// PRIVATE

const normalizeIntervals = <T extends TimeInterval>(
  track: SpotifyApi.SingleTrackResponse,
  intervals: T[]
): T[] => {
  const normalizedIntervals = [...intervals];

  // Ensure first interval of each type starts at zero.
  normalizedIntervals[0].duration =
    normalizedIntervals[0].start + normalizedIntervals[0].duration;
  normalizedIntervals[0].start = 0;

  // Ensure last interval of each type ends at the very end of the track.
  normalizedIntervals[normalizedIntervals.length - 1].duration =
    track.duration_ms / 1000 -
    normalizedIntervals[normalizedIntervals.length - 1].start;

  // Convert every time value to milliseconds for our later convenience.
  return normalizedIntervals.map((interval) => ({
    ...interval,
    start: interval.start * 1000,
    duration: interval.duration * 1000,
  }));
};

////////////////////////////////////////////////////////////
/// PUBLIC

interface SpotifyEvents {
  newBar: (current: TimeInterval, next: TimeInterval | null) => void;
  newBeat: (current: TimeInterval, next: TimeInterval | null) => void;
  newSection: (current: Section, next: Section | null) => void;
  newSegment: (current: Segment, next: Segment | null) => void;
  newTatum: (current: TimeInterval, next: TimeInterval | null) => void;
  trackChange: (track: SpotifyApi.SingleTrackResponse) => void;
  trackStopped: () => void;
}

export class Spotify extends TypedEmitter<SpotifyEvents> {
  accessToken: string | null = null;
  refreshToken: string | null = null;
  client: spotify;
  clientId: string;
  clientSecret: string;

  currentTrackOffsetThreshold: number = 100;
  currentTrack: SpotifyApi.SingleTrackResponse | null = null;
  currentTrackAnalysis: AudioAnalysisWithInterval | null = null;
  currentTrackProgress: number = 0;
  currentTrackProgressInterval: NodeJS.Timer | null = null;
  currentTrackProgressIntervalMs: number = 10;
  currentTrackStartTime: number = 0;
  currentTrackStartOffset: number = 0;

  pingTimeout: NodeJS.Timeout | null = null;
  pingTimeoutMs: number = 1000;

  constructor(args: { clientId: string; clientSecret: string }) {
    super();

    const { clientId, clientSecret } = args;

    this.clientId = clientId;
    this.clientSecret = clientSecret;

    this.client = new spotify({
      clientId,
      clientSecret,
    });
  }

  private _getInterval<T extends keyof AudioAnalysisWithInterval>(
    kind: T
  ): AudioAnalysisWithInterval[T] {
    if (!this.currentTrackAnalysis) {
      throw new Error('current track not set!');
    }

    return this.currentTrackAnalysis[kind];
  }

  private _getActiveInterval<T extends keyof AudioAnalysis>(
    kind: T
  ): AudioAnalysis[T][0] {
    const interval = this._getInterval(kind);
    return interval.intervals[interval.activeIndex];
  }

  private _calculateNextTimeout(kind: keyof AudioAnalysis): number {
    const activeInterval = this._getActiveInterval(kind);

    return (
      activeInterval.duration -
      (this.currentTrackProgress - activeInterval.start)
    );
  }

  private _incrementInterval(kind: keyof AudioAnalysis): void {
    const interval = this._getInterval(kind);

    if (interval.activeIndex === interval.intervals.length - 1) {
      return;
    }

    this._stageInterval(kind);

    interval.activeIndex += 1;
  }

  private _fireInterval(kind: keyof AudioAnalysis): void {
    const activeInterval = this._getActiveInterval(kind);
    const { activeIndex, intervals } = this._getInterval(kind);
    const nextInterval = intervals[activeIndex + 1] || null;

    switch (kind) {
      case 'bars':
        this.emit('newBar', activeInterval, nextInterval);
        break;
      case 'beats':
        this.emit('newBeat', activeInterval, nextInterval);
        break;
      case 'sections':
        this.emit(
          'newSection',
          (activeInterval as unknown) as Section,
          (nextInterval as unknown) as Section
        );
        break;
      case 'segments':
        this.emit(
          'newSegment',
          (activeInterval as unknown) as Segment,
          (nextInterval as unknown) as Segment
        );
        break;
      case 'tatums':
        this.emit('newTatum', activeInterval, nextInterval);
        break;
    }

    this._incrementInterval(kind);
  }

  private _stageInterval(kind: keyof AudioAnalysis): void {
    const interval = this._getInterval(kind);

    interval.nextIntervalTimeout = setTimeout(
      () => this._fireInterval(kind),
      this._calculateNextTimeout(kind)
    );
  }

  private _syncInterval(kind: keyof AudioAnalysis): void {
    const interval = this._getInterval(kind);
    const { intervals } = interval;

    for (let i = 0; i < intervals.length; i += 1) {
      if (
        this.currentTrackProgress >= intervals[i].start &&
        this.currentTrackProgress < intervals[i].start + intervals[i].duration
      ) {
        interval.activeIndex = i;
        break;
      }
    }

    this._stageInterval(kind);
  }

  private _calculateTrackProgress(): void {
    if (!this.currentTrackStartTime) {
      throw new Error("track hasn't started!");
    }

    this.currentTrackProgress =
      this.currentTrackStartOffset + (Date.now() - this.currentTrackStartTime);
  }

  private async _getCurrentlyPlaying(): Promise<void> {
    const logPrefix = 'clients.spotify.Spotify._getCurrentlyPlaying:';

    const now = Date.now();
    const {
      body: { item, is_playing: isPlaying, progress_ms: resProgressMs },
    } = await this.client.getMyCurrentPlayingTrack();

    if (!isPlaying || !item || resProgressMs === null) {
      logger.info(`${logPrefix} nothing playing on spotify`);
      if (this.currentTrack) {
        this.emit('trackStopped');
      }
      this._stopTrack();
      this._clearTrack();
      return this._pingSpotify();
    }

    const progressMs = resProgressMs + (Date.now() - now);

    if (!this.currentTrack || this.currentTrack.id !== item.id) {
      logger.info(`${logPrefix} no track currently playing or wrong track`);
      this._stopTrack();
      this._clearTrack();
      await this._getTrack(item.id);
      this._startTrack(progressMs);
      return this._pingSpotify();
    }

    if (
      Math.abs(this.currentTrackProgress - progressMs) >
      this.currentTrackOffsetThreshold
    ) {
      logger.error(`${logPrefix} current track out of sync`);
      this._stopTrack();
      this._startTrack(progressMs);
    } else {
      logger.info(`${logPrefix} current track in sync`);
    }
    return this._pingSpotify();
  }

  private _pingSpotify(): void {
    this.pingTimeout = setTimeout(
      () => this._getCurrentlyPlaying(),
      this.pingTimeoutMs
    );
  }

  private _stopTrack(): void {
    if (this.currentTrackProgressInterval) {
      clearInterval(this.currentTrackProgressInterval);
    }

    if (this.currentTrackAnalysis) {
      for (const analysis of Object.values(this.currentTrackAnalysis)) {
        if (analysis.nextIntervalTimeout) {
          clearTimeout(analysis.nextIntervalTimeout);
        }
      }
    }
  }

  private _clearTrack(): void {
    this.currentTrack = null;
    this.currentTrackAnalysis = null;
    this.currentTrackProgress = 0;
    this.currentTrackStartTime = 0;
  }

  private async _getTrack(trackId: string): Promise<void> {
    const logPrefix = 'clients.spotify.Spotify._getTrack:';
    logger.info(`${logPrefix} getting track info for trackId ${trackId}...`);
    const { body: track } = await this.client.getTrack(trackId);
    this.currentTrack = track;
    logger.info(
      `${logPrefix} trackId ${trackId} is ${track.name} by ${track.artists}`
    );
    logger.info(`${logPrefix} getting audio analysis for ${track.name}...`);
    const { body: analysis } = ((await this.client.getAudioAnalysisForTrack(
      trackId
    )) as unknown) as { body: AudioAnalysis };
    logger.info(`${logPrefix} normalizing audio analysis for ${track.name}...`);
    this.currentTrackAnalysis = {
      bars: {
        activeIndex: 0,
        intervals: normalizeIntervals(track, analysis.bars),
        nextIntervalTimeout: null,
      },
      beats: {
        activeIndex: 0,
        intervals: normalizeIntervals(track, analysis.beats),
        nextIntervalTimeout: null,
      },
      sections: {
        activeIndex: 0,
        intervals: normalizeIntervals(track, analysis.sections),
        nextIntervalTimeout: null,
      },
      segments: {
        activeIndex: 0,
        intervals: normalizeIntervals(track, analysis.segments),
        nextIntervalTimeout: null,
      },
      tatums: {
        activeIndex: 0,
        intervals: normalizeIntervals(track, analysis.tatums),
        nextIntervalTimeout: null,
      },
    };
    logger.info(`${logPrefix} all track info for ${track.name} loaded`);
    this.emit('trackChange', track);
  }

  private _startTrack(start: number): void {
    if (!this.currentTrack) {
      throw new Error('current track not set!');
    }

    this.currentTrackStartOffset = start;
    this.currentTrackProgress = start;
    this.currentTrackStartTime = Date.now();

    this.currentTrackProgressInterval = setInterval(
      () => this._calculateTrackProgress(),
      this.currentTrackProgressIntervalMs
    );

    const intervals: (keyof AudioAnalysis)[] = [
      'bars',
      'beats',
      'sections',
      'segments',
      'tatums',
    ];
    for (const interval of intervals) {
      this._syncInterval(interval);
    }
  }

  start(): void {
    this._pingSpotify();
  }

  async getAccessToken(): Promise<void> {
    const logPrefix = 'clients.spotify.Spotify._getCurrentlyPlaying:';

    const authorizeUrl = new url.URL(
      '/authorize',
      'https://accounts.spotify.com'
    );
    authorizeUrl.searchParams.append('response_type', 'code');
    authorizeUrl.searchParams.append('client_id', this.clientId);
    authorizeUrl.searchParams.append('redirect_uri', 'http://localhost:8082/');
    authorizeUrl.searchParams.append('scopes', 'user-read-currently-playing');

    logger.info(`${logPrefix} starting server to wait for code`);

    const app = express();
    const server = app.listen(8082);
    let code: string | null = null;

    await new Promise<void>((resolve) => {
      app.use((req, res) => {
        code = req.query.code as string;
        res.sendStatus(200);
        resolve();
      });

      logger.info(
        `${logPrefix} launching browser to authenticate with spotify`
      );
      open(authorizeUrl.toString());
    });

    server.close();

    if (!code) {
      throw new Error('unable to get authorization code!');
    }

    logger.info(
      `${logPrefix} authorization code aquired, exchanging code for token`
    );

    const body = new url.URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('code', code);
    body.append('redirect_uri', 'http://localhost:8082/');

    const tokenRequest = await fetch('https://accounts.spotify.com/api/token', {
      body,
      headers: {
        authorization: `Basic ${buffer.Buffer.from(
          `${this.clientId}:${this.clientSecret}`
        ).toString('base64')}`,
      },
      method: 'POST',
    });

    const tokenBody: {
      access_token: string;
      refresh_token: string;
    } = await tokenRequest.json();

    if (!tokenBody.access_token || !tokenBody.refresh_token) {
      throw new Error('unable to exchange authorization code for tokens!');
    }

    logger.info(`${logPrefix} tokens acquired`);

    this.accessToken = tokenBody.access_token;
    this.refreshToken = tokenBody.refresh_token;
    this.client.setAccessToken(this.accessToken);
    this.client.setRefreshToken(this.refreshToken);
  }
}

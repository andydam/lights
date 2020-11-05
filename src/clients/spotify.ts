/// <reference types="spotify-api" />

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
  intervals: T[],
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
    duration: interval.start * 1000,
  }));
};

////////////////////////////////////////////////////////////
/// PUBLIC

interface SpotifyEvents {
  trackChange: (track: SpotifyApi.SingleTrackResponse) => void;
  interval: <T extends keyof AudioAnalysisWithInterval>(
    kind: T,
    interval: AudioAnalysisWithInterval[T]['intervals'][0],
  ) => void;
}

export class Spotify extends TypedEmitter<SpotifyEvents> {
  accessToken: string;
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

  constructor(args: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
  }) {
    super();

    const { accessToken, clientId, clientSecret } = args;

    this.accessToken = accessToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    this.client = new spotify({
      accessToken,
      clientId,
      clientSecret,
    });
  }

  private _getInterval<T extends keyof AudioAnalysisWithInterval>(
    kind: T,
  ): AudioAnalysisWithInterval[T] {
    if (!this.currentTrackAnalysis) {
      throw new Error('current track not set!');
    }

    return this.currentTrackAnalysis[kind];
  }

  private _getActiveInterval<T extends keyof AudioAnalysisWithInterval>(
    kind: T,
  ): AudioAnalysisWithInterval[T]['intervals'][0] {
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

    this.emit('interval', kind, activeInterval);

    this._incrementInterval(kind);
  }

  private _stageInterval(kind: keyof AudioAnalysis): void {
    const interval = this._getInterval(kind);

    interval.nextIntervalTimeout = setTimeout(
      () => this._fireInterval(kind),
      this._calculateNextTimeout(kind),
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
      this.pingTimeoutMs,
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
      `${logPrefix} trackId ${trackId} is ${track.name} by ${track.artists}`,
    );
    logger.info(`${logPrefix} getting audio analysis for ${track.name}...`);
    const { body: analysis } = ((await this.client.getAudioAnalysisForTrack(
      trackId,
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
      this.currentTrackProgressIntervalMs,
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
}

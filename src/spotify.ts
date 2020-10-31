/// <reference types="spotify-api" />

import { TypedEmitter } from 'tiny-typed-emitter';
import spotify from 'spotify-web-api-node';

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
  pitches: number;
  timbre: number;
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

const sleep = (delay: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delay));

////////////////////////////////////////////////////////////
/// PUBLIC

interface SpotifyEvents {
  trackChange: (track: SpotifyApi.SingleTrackResponse) => void;
  interval: (kind: keyof AudioAnalysis, interval: TimeInterval) => void;
}

export class Spotify extends TypedEmitter<SpotifyEvents> {
  accessToken: string;
  client: spotify;
  clientId: string;
  clientSecret: string;

  currentTrack: SpotifyApi.SingleTrackResponse | null = null;
  currentTrackAnalysis: AudioAnalysisWithInterval | null = null;
  currentTrackProgress: number = 0;

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

    for (let i = interval.activeIndex; i < intervals.length; i += 1) {
      if (
        this.currentTrackProgress >= intervals[i].start &&
        this.currentTrackProgress < intervals[i + 1].start
      ) {
        interval.activeIndex = i;
        break;
      }
    }

    this._stageInterval(kind);
  }

  async getTrack(trackId: string): Promise<void> {
    console.log(`getting track info for trackId ${trackId}...`);
    const { body: track } = await this.client.getTrack(trackId);
    this.currentTrack = track;
    console.log(`trackId ${trackId} is ${track.name} by ${track.artists}`);
    console.log(`getting audio analysis for ${track.name}...`);
    const { body: analysis } = ((await this.client.getAudioAnalysisForTrack(
      trackId,
    )) as unknown) as { body: AudioAnalysis };
    console.log(`normalizing audio analysis for ${track.name}...`);
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
    console.log(`all track info for ${track.name} loaded`);
    this.emit('trackChange', track);
  }

  async startTrack(): Promise<void> {
    if (!this.currentTrack) {
      throw new Error('current track not set!');
    }

    const startTime = Date.now();
    this._syncInterval('beats');

    while (this.currentTrackProgress < this.currentTrack.duration_ms) {
      this.currentTrackProgress = Date.now() - startTime;
      await sleep(10);
      console.log(this.currentTrackProgress);
    }
  }
}

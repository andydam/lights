import * as d3Interpolate from 'd3-interpolate';

import SettingsJSON from '../settings.json';

////////////////////////////////////////////////////////////
/// PRIVATE

const InterpolatorMap: {
  [key: string]: typeof d3Interpolate.interpolateHsl;
} = {
  interpolateHcl: d3Interpolate.interpolateHcl,
  interpolateHclLong: d3Interpolate.interpolateHslLong,
  interpolateHsl: d3Interpolate.interpolateHsl,
  interpolateHslLong: d3Interpolate.interpolateHslLong,
  interpolateRgb: d3Interpolate.interpolateRgb,
};

interface Settings {
  colors: {
    start: string;
    end: string;
    interpolator: keyof typeof InterpolatorMap;
  };
  debug: boolean;
  lightbulbMACAddresses: string[];
  spotify: {
    clientId: string;
    clientSecret: string;
  };
}

////////////////////////////////////////////////////////////
/// PUBLIC

export const Settings = SettingsJSON as Settings;

export const getInterpolator = () =>
  InterpolatorMap[Settings.colors.interpolator](
    Settings.colors.start,
    Settings.colors.end
  );

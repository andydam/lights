# lights

Spotify current track visualizer for Govee H6001701 Bluetooth LED lights (https://www.amazon.com/gp/product/B07CL2RMR7)

See this in action:

[![Youtube video](https://img.youtube.com/vi/2b52x-gbnKc/0.jpg)](https://www.youtube.com/watch?v=2b52x-gbnKc)

## Getting Started

1. Create an application on Spotify's developer dashboard, adding `http://localhost:8082/` as a Redirect URI for the application
1. Fill in `spotify.clientId` and `spotify.clientSecret` in the `settings.json` file with the client ID and secret from Spotify
1. Get MAC addresses for lightbulbs, add MAC addresses to `lightbulbMACAddresses` in `settings.json`
1. Start the application by running `yarn start` and enjoy the light show!

## Acknowledgements

- Govee LED Client from https://gitlab.com/nanoguy0/govee-led-client
- Spotify loop from https://github.com/lukefredrickson/spotify-led-visualizer

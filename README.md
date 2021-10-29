# Roboflow Server Benchmark Tool

This simple tool will fire a series of inference requests at the
[Roboflow remote inference API](https://docs.roboflow.com/inference/hosted-api)
or one of
[our Docker containers](https://hub.docker.com/r/roboflow/inference-server/tags)
running on your hardware and measures the throughput.

## Requirements

A recent version of Node.js (eg 12 or higher).

## Installation

`cd` into this directory and run `npm install`.

Optional: place your test images in the `images` folder; the repo contains some
images from the [EgoHands dataset](https://universe.roboflow.com/brad-dwyer/egohands-public)

## Usage

Edit `benchmark.js` to add your API Key and model endpoint then configure which
deployment target you're testing (and its local IP address if applicable).

Then run `node benchmark.js`

## Alternative Authentication

You can also set a ROBOFLOW_KEY environment variable or put your API key into a
`.roboflow_key` file in this directory.

# AnimeThemes Batch Encoder

## Description

Generate and execute collection of FFmpeg commands sequentially from external file to produce WebMs that meet [AnimeThemes.moe](https://animethemes.moe) encoding standards.

Take advantage of sleep, work, or any other time that we cannot actively monitor the encoding process to produce a set of encodes for later quality checking and/or tweaking for additional encodes.

Ideally we are iterating over a combination of filters and settings, picking the best one at the end.

## Encoding

### Requirements

- FFmpeg ^7.x (ffmpeg-release-full.7z from release builds)

### Install

1. Download the `.exe` file from the [latest release](https://github.com/AnimeThemes/animethemes-batch-encoder-ts/releases)
2. Run the `.exe` file once. It'll install the `batch-encoder.exe` and add it to the Windows PATH as `batch-encoder`.
3. Now you can use anywhere by running `batch-encoder` in the CMD.

### Usage

```
batch-encoder [generate | g] [execute | e] [update] [--file [FILE]] [--config-file [FILE]]
```

#### Mode

`generate` generates commands from input files in the current directory.
The user will be prompted for values that are not determined programmatically, such as inclusion/exclusion of a source file candidate, start time, end time, output file name and new audio filters.

`execute` executes commands from file in the current directory line-by-line.

`update` will search for the latest release in the GitHub repository and update the script. Restarting the CMD is required.

#### File 

The file that commands are written to or read from.

By default, the program will write to or read from `commands.txt` in the current directory.

#### Config File

The configuration file in which our encoding properties are defined.

By default, the program will write to or read from `config.json` in the current directory or in the user config directory of appname batch-encoder.

Example: C:\Users\AnimeThemes\\.config\batch-encoder\config.json

`allowedFileTypes` is an array listing of file extensions that will be considered for source file candidates.

`encodingModes` is an array listing of bitrate control modes for inclusion and ordering of commands.

Available bitrate control modes are:

* CBR Constant Bitrate Mode
* VBR Variable Bitrate Mode
* CQ Constrained Quality Mode

`crfs` is an array listing of ordered CRF values to use with VBR and/or CQ.

`cbrBitrates` is an array listing of ordered bitrate values to use with CBR and/or CQ.

`cbrMaxBitrates` is an array listing of ordered maximum bitrate values to use with CBR.

`threads` is the number of threads used to encode. Default is 4.

`limitSizeEnable` is a flag for including the `-fs` argument to terminate an encode when it exceeds the allowed size. Default is `true`.

`videoFilters` is a configuration item list used for named video filtergraphs for each bitrate control mode and CRF pairing.

#### Audio Filters

* Fade In: Select an exponential value to apply Fade In.
* Fade Out: Select a start position and an exponential value to Fade Out.
* Mute: Select a start and end position to leave the volume at 0.
* Custom: Apply a custom audio filter string.

#### Video Filters

* No Filters: Add a line without filter.
* scale=-1:720: Add downscale to 720p.
* scale=-1:720,hqdn3d=0:0:3:3,gradfun,unsharp: Add downscale to 720p and nuked filter.
* hqdn3d=0:0:3:3,gradfun,unsharp: Add a nuked filter.
* hqdn3d=0:0:3:3: Add lightdenoise filter.
* hqdn3d=1.5:1.5:6:6: Add heavydenoise filter.
* unsharp: Add unsharp filter.
* Custom: Apply a custom video filter string.

## Development

### Requirements

- Bun v1.2.18 or newer
- FFmpeg 7.x

Install dependencies:

```bash
bun install
```

Run the batch encoder:

```bash
bun run dev
```

Building for Windows:

```
bun run build:win
```
import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';

function execFileAsync(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(
          error instanceof Error ? error : new Error('Unknown execFile error'),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
}

interface FfprobeStream {
  codec_type: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

@Injectable()
export class FfmpegService {
  async probeMetadata(inputPath: string): Promise<VideoMetadata> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const videoStream = parsed.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    if (!videoStream) {
      throw new Error('No video stream found in probed metadata');
    }

    const durationSource = parsed.format?.duration ?? videoStream.duration;
    const durationSeconds = parseFloat(durationSource ?? '0');

    return {
      durationSeconds,
      width: videoStream.width ?? 0,
      height: videoStream.height ?? 0,
    };
  }

  async extractThumbnail(
    inputPath: string,
    outputPath: string,
    atSecond: number,
  ): Promise<void> {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(atSecond),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      outputPath,
    ]);
  }
}

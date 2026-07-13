import { execFile } from 'child_process';
import { FfmpegService } from './ffmpeg.service';

jest.mock('child_process');

const mockExecFile = execFile as unknown as jest.Mock;

describe('FfmpegService', () => {
  let service: FfmpegService;

  beforeEach(() => {
    service = new FfmpegService();
    mockExecFile.mockReset();
  });

  describe('probeMetadata', () => {
    it('invokes ffprobe with the expected arguments and parses duration/width/height', async () => {
      const ffprobeOutput = JSON.stringify({
        format: { duration: '12.500000' },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      });
      mockExecFile.mockImplementation((_file, _args, callback) => {
        callback(null, ffprobeOutput, '');
      });

      const result = await service.probeMetadata('/tmp/input.mp4');

      expect(mockExecFile).toHaveBeenCalledWith(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          '/tmp/input.mp4',
        ],
        expect.any(Function),
      );
      expect(result).toEqual({
        durationSeconds: 12.5,
        width: 1920,
        height: 1080,
      });
    });

    it('throws when no video stream is present in the probed output', async () => {
      const ffprobeOutput = JSON.stringify({
        format: { duration: '1' },
        streams: [{ codec_type: 'audio' }],
      });
      mockExecFile.mockImplementation((_file, _args, callback) => {
        callback(null, ffprobeOutput, '');
      });

      await expect(service.probeMetadata('/tmp/input.mp4')).rejects.toThrow(
        'No video stream found',
      );
    });

    it('rejects when ffprobe exits with an error', async () => {
      mockExecFile.mockImplementation((_file, _args, callback) => {
        callback(new Error('ffprobe: invalid data'), '', 'invalid data');
      });

      await expect(service.probeMetadata('/tmp/input.mp4')).rejects.toThrow(
        'ffprobe: invalid data',
      );
    });
  });

  describe('extractThumbnail', () => {
    it('invokes ffmpeg with the expected arguments', async () => {
      mockExecFile.mockImplementation((_file, _args, callback) => {
        callback(null, '', '');
      });

      await service.extractThumbnail('/tmp/input.mp4', '/tmp/thumb.jpg', 1.5);

      expect(mockExecFile).toHaveBeenCalledWith(
        'ffmpeg',
        [
          '-y',
          '-ss',
          '1.5',
          '-i',
          '/tmp/input.mp4',
          '-frames:v',
          '1',
          '/tmp/thumb.jpg',
        ],
        expect.any(Function),
      );
    });

    it('rejects when ffmpeg exits with an error', async () => {
      mockExecFile.mockImplementation((_file, _args, callback) => {
        callback(new Error('ffmpeg: no such file'), '', 'no such file');
      });

      await expect(
        service.extractThumbnail('/tmp/missing.mp4', '/tmp/thumb.jpg', 1),
      ).rejects.toThrow('ffmpeg: no such file');
    });
  });
});

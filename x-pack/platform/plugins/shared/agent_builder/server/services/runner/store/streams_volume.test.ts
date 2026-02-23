/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FileEntryType } from '@kbn/agent-builder-server/runner/filestore';
import { MemoryVolume } from './filesystem';
import { createWriteStreamContext, STREAMS_MOUNT_PATH } from './streams_volume';

describe('streams_volume', () => {
  describe('STREAMS_MOUNT_PATH', () => {
    it('is /streams', () => {
      expect(STREAMS_MOUNT_PATH).toBe('/streams');
    });
  });

  describe('createWriteStreamContext', () => {
    it('writes content to the volume at the given path', async () => {
      const volume = new MemoryVolume('streams');
      const write = createWriteStreamContext(volume, STREAMS_MOUNT_PATH);

      await write('/streams/my-stream.json', '{"stream":"my-stream","features":[]}');

      const entry = await volume.get('/streams/my-stream.json');
      expect(entry).toBeDefined();
      expect(entry?.content.plain_text).toBe('{"stream":"my-stream","features":[]}');
      expect(entry?.metadata.type).toBe(FileEntryType.streamContext);
      expect(entry?.metadata.id).toBe('/streams/my-stream.json');
    });

    it('normalizes path without leading slash', async () => {
      const volume = new MemoryVolume('streams');
      const write = createWriteStreamContext(volume, STREAMS_MOUNT_PATH);

      await write('streams/foo.json', '{}');

      expect(volume.has('/streams/foo.json')).toBe(true);
    });

    it('parses JSON content as raw', async () => {
      const volume = new MemoryVolume('streams');
      const write = createWriteStreamContext(volume, STREAMS_MOUNT_PATH);
      const data = { stream: 's1', features: [{ id: 'f1' }] };

      await write('/streams/s1.json', JSON.stringify(data));

      const entry = await volume.get('/streams/s1.json');
      expect(entry?.content.raw).toEqual(data);
    });

    it('rejects path not under /streams/', async () => {
      const volume = new MemoryVolume('streams');
      const write = createWriteStreamContext(volume, STREAMS_MOUNT_PATH);

      await expect(write('/other/file.json', '{}')).rejects.toThrow(
        'Stream context path must start with /streams/'
      );
    });

    it('rejects path containing ..', async () => {
      const volume = new MemoryVolume('streams');
      const write = createWriteStreamContext(volume, STREAMS_MOUNT_PATH);

      await expect(write('/streams/../etc/passwd', '{}')).rejects.toThrow(
        "must not contain '..'"
      );
    });
  });
});

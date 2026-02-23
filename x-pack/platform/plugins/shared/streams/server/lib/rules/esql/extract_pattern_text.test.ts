/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { extractPatternText } from './executor';

describe('extractPatternText', () => {
  it('returns undefined when neither body.text nor message is present', () => {
    expect(extractPatternText({ foo: 'bar' })).toBeUndefined();
  });

  it('extracts flat body.text field (OTel dot-notation)', () => {
    expect(extractPatternText({ 'body.text': 'Connection refused' })).toBe('Connection refused');
  });

  it('extracts nested body.text field (OTel nested object)', () => {
    expect(extractPatternText({ body: { text: 'Timeout waiting for response' } })).toBe(
      'Timeout waiting for response'
    );
  });

  it('extracts message field (ECS format)', () => {
    expect(extractPatternText({ message: 'Error processing request' })).toBe(
      'Error processing request'
    );
  });

  it('prefers body.text (flat) over message', () => {
    expect(
      extractPatternText({ 'body.text': 'OTel message', message: 'ECS message' })
    ).toBe('OTel message');
  });

  it('prefers body.text (nested) over message', () => {
    expect(
      extractPatternText({ body: { text: 'OTel nested' }, message: 'ECS message' })
    ).toBe('OTel nested');
  });

  it('falls back to message when body.text is not a string', () => {
    expect(extractPatternText({ 'body.text': 123, message: 'fallback' })).toBe('fallback');
  });

  it('returns undefined when body.text and message are non-string', () => {
    expect(extractPatternText({ 'body.text': 42, message: true })).toBeUndefined();
  });

  it('returns undefined for empty source', () => {
    expect(extractPatternText({})).toBeUndefined();
  });

  it('ignores body object without text property', () => {
    expect(extractPatternText({ body: { other: 'value' } })).toBeUndefined();
  });

  it('prefers flat body.text over nested body.text', () => {
    expect(
      extractPatternText({ 'body.text': 'flat wins', body: { text: 'nested loses' } })
    ).toBe('flat wins');
  });
});

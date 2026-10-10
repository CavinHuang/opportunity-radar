import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed,configuredFeeds } from '../src/signals.mjs';
test('RSS parser extracts true HTTPS source and no invented content',()=>{
  const xml='<rss><channel><item><title><![CDATA[Too many screenshots]]></title><link>https://example.com/thread/1</link><description><![CDATA[I lost my notes again]]></description></item></channel></rss>';
  const items=parseFeed(xml,'https://example.com/feed');assert.equal(items.length,1);assert.equal(items[0].description,'I lost my notes again');assert.equal(items[0].status,'signal_only');
});
test('configured feeds restrict protocols and number',()=>{
 assert.deepEqual(configuredFeeds('http://bad.com/rss,https://example.org/rss,not-url'),['https://example.org/rss']);
});

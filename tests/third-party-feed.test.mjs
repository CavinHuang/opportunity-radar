import test from 'node:test';import assert from 'node:assert/strict';
import {makeCommunityFeed} from '../src/third-party-feed.mjs';
test('valid custom third-party feed templates have trusted public endpoints',()=>{
 const a=makeCommunityFeed({provider:'openrss-reddit',community:'r/SaaS'});
 assert.equal(a.url,'https://openrss.org/www.reddit.com/r/SaaS/');
 const b=makeCommunityFeed({provider:'rsshub-x',account:'@DIYgod'});
 assert.equal(b.url,'https://rsshub.app/twitter/user/DIYgod');
});
test('custom instances, illegal handles, and unsupported providers are blocked',()=>{
 for(const args of [{provider:'openrss-reddit',community:'a/b'},{provider:'rsshub-x',account:'invalid/account'},{provider:'rsshub-x',account:'valid',instance:'https://localhost/'},{provider:'rsshub-x',account:'valid',instance:'https://evil.example/'}])
 assert.throws(()=>makeCommunityFeed(args));
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',testMatch:'*.spec.ts',fullyParallel:false,workers:1,retries:process.env.CI?1:0,globalTimeout:10*60*1000,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',trace:'retain-on-failure',screenshot:'on',video:'retain-on-failure'},
  projects:[{name:'desktop',use:{viewport:{width:1280,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
  webServer:{command:'node tests/browser/server.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:60000},
});

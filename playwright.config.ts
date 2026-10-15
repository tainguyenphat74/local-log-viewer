import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:19876',headless:true},reporter:'list'});

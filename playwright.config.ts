import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/ui',timeout:30000,use:{baseURL:'http://127.0.0.1:3002',headless:true,channel:'chrome'},workers:1,reporter:'list'});

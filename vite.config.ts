import { defineConfig } from 'vite';
import { videoUpload } from './vite-video';

export default defineConfig({ plugins: [videoUpload()] });

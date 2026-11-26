/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare module 'fs-native-extensions' {
  export function tryLock(fd: number): boolean;
}

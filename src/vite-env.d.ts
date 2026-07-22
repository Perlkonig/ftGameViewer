/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'rfdc/default' {
    export default function clone<T>(input: T): T;
}

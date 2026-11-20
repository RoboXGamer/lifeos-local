import type { ParentProps } from 'solid-js';

export default function Document(props: ParentProps) {
  return <html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="theme-color" content="#f8f9fd" /><title>LifeOS</title><link rel="icon" href="/favicon.ico" /></head><body>{props.children}</body></html>;
}

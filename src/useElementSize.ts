import { createSignal, createEffect } from "solid-js";

export function useElementSize<T extends HTMLElement = HTMLElement>() {
  const [width, setWidth] = createSignal(0);
  const [height, setHeight] = createSignal(0);
  const [el, setEl] = createSignal<T | null>(null);

  const ref = (element: T) => {
    setEl(() => element);
  };

  createEffect(
    () => el(),
    (current) => {
      if (!current) return;

      const updateSize = () => {
        const rect = current.getBoundingClientRect();
        setWidth(Math.round(rect.width * 100) / 100);
        setHeight(Math.round(rect.height * 100) / 100);
      };

      updateSize();

      const observer = new ResizeObserver(updateSize);
      observer.observe(current);

      return () => observer.disconnect();
    },
  );

  return { ref, width, height } as const;
}

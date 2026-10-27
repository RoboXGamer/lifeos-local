export function PlaceholderPage(props: { title: string }) {
  return (
    <section class="page-state">
      <span>Life OS</span>
      <h2>{props.title}</h2>
      <p>This surface is prepared for its next product slice.</p>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <main class="page-state page-state-full">
      <span>404</span>
      <h1>This page drifted out of view.</h1>
      <a href="/app/areas">Return to Areas</a>
    </main>
  );
}

export function RouteErrorPage(props: { error: unknown }) {
  const message =
    props.error instanceof Error
      ? props.error.message
      : "Life OS could not open this page.";

  return (
    <main class="page-state page-state-full">
      <span>Something went wrong</span>
      <h1>We couldn’t open this part of Life OS.</h1>
      <p>{message}</p>
      <a href="/app/areas">Return to Areas</a>
    </main>
  );
}

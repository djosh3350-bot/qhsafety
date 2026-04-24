export default function middleware(request) {
  return new Response("This site is temporarily paused.", { status: 503 });
}

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * DEV SERVER + WORKER PROXY
 * ------------------------------------------------------------------
 * In production the Worker sits on the same origin as the static site
 * under /api/*, so the frontend requests a relative path and there is no
 * CORS preflight at all.
 *
 * Locally those are two processes on two ports. Rather than widening CORS
 * to cover whatever port Vite happens to choose today, the dev server
 * proxies /api to the Worker. The frontend therefore makes the SAME
 * same-origin requests in development as it does in production — which
 * means a routing or header mistake shows up locally instead of on day
 * one of launch.
 *
 * Start both:
 *   npm run api:dev        # :8787
 *   npm run dev            # :5173
 *
 * If something else already holds 8787 (a previous run of the bridge that
 * never exited, for example), start the API on another port and tell the
 * proxy about it — both processes read the same variable, so there is no
 * chance of them disagreeing:
 *
 *   API_PORT=8788 npm run api:dev
 *   API_PORT=8788 npm run dev
 *
 * A second reason to move ports: a listener can hold 8787 outside the
 * shell's process table, so it cannot be killed from here. It answers
 * /api/health perfectly while serving Worker code from some earlier run —
 * which looks healthy and is not. Moving to a port this session started
 * guarantees the code being tested is the code on disk.
 */
const API_PORT = process.env.API_PORT ?? '8787'

/** Fail loudly instead of hanging when nothing is listening on API_PORT. */
const proxyErrorHandler = (proxy: {
  on: (event: string, cb: (err: Error & { code?: string }) => void) => void
}) => {
  proxy.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      console.error(
        `\n[proxy] nothing is listening on :${API_PORT}, so /api requests will fail.\n` +
          `        Start it with:  ${API_PORT === '8787' ? '' : `API_PORT=${API_PORT} `}npm run api:dev\n`,
      )
    } else if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
      // The browser closed a request it no longer needed (a navigation, an
      // aborted fetch). Not a fault, and not worth a scary log line.
      return
    } else {
      console.error(`\n[proxy] /api → :${API_PORT} failed: ${err.message}\n`)
    }
  })
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: false,
        configure: proxyErrorHandler,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: false,
        configure: proxyErrorHandler,
      },
    },
  },
  build: {
    target: 'es2019',
    cssCodeSplit: true,
  },
})

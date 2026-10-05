import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { picaroo } from '../vite.mjs'

const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = path.resolve(process.argv[2])
const port = Number(process.argv[3])
const editorOrigin = process.argv[4]

if (!root || !Number.isInteger(port) || !editorOrigin)
  throw new Error('Usage: node test/start-react.mjs <root> <port> <editor-origin>')

const server = await createServer({
  configFile: false,
  root,
  plugins: [picaroo({ editorOrigin }), react()],
  resolve: {
    alias: [
      { find: 'react-dom', replacement: path.join(repository, 'node_modules', 'react-dom') },
      { find: 'react', replacement: path.join(repository, 'node_modules', 'react') },
    ],
  },
  server: { host: 'localhost', port, strictPort: true },
})

await server.listen()

const stop = async () => {
  await server.close()
  process.exit(0)
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

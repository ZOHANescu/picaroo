import { register } from 'tsx/esm/api'
register()
const { picaroo } = await import('./src/vite.ts')
export { picaroo }

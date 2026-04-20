import express from 'express'
import cors from 'cors'
import { initOrbitDB, closeOrbitDB } from './services/orbitdb.js'
import auditRoutes from './routes/audit.js'

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// Routes
app.use('/audit', auditRoutes)

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'audit-controller' })
})

// Graceful Shutdown handling
const handleShutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down...`)
  await closeOrbitDB()
  process.exit(0)
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))

// Start server after OrbitDB is initialized
const start = async () => {
  try {
    await initOrbitDB()
    app.listen(PORT, () => {
      console.log(`[Audit Controller] Express server listening on port ${PORT}`)
    })
  } catch (error) {
    console.error('[Audit Controller] Critical failure on startup:', error)
    process.exit(1)
  }
}

start()

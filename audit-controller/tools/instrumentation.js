import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { trace } from '@opentelemetry/api'
import pino from 'pino'

const logger = pino({
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: { destination: '../observability/logs/audit-controller.log', mkdir: true },
        level: 'info'
      }
    ]
  }
})

const getLogger = () => {
  const span = trace.getActiveSpan()
  if (!span) return logger
  const { traceId, spanId } = span.spanContext()
  return logger.child({ traceId, spanId })
}

const sdk = new NodeSDK({
  serviceName: 'audit-controller',
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces'
  }),
  instrumentations: [getNodeAutoInstrumentations()]
})

sdk.start()

export { getLogger }
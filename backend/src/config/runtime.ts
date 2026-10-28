import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

function requireEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Required environment variable ${name} is not configured.`)
  return value
}

const ssm = new SSMClient({})
const secretCache = new Map<string, Promise<Uint8Array>>()

async function getSecureSecret(parameterEnvironmentName: string, minimumBytes: number) {
  const cached = secretCache.get(parameterEnvironmentName)
  if (cached) return cached
  const pending = (async () => {
    const parameterName = requireEnvironment(parameterEnvironmentName)
    const result = await ssm.send(new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    }))
    const value = result.Parameter?.Value
    if (!value || Buffer.byteLength(value, 'utf8') < minimumBytes) {
      throw new Error(`${parameterEnvironmentName} must refer to a SecureString with at least ${minimumBytes} bytes.`)
    }
    return new TextEncoder().encode(value)
  })()
  secretCache.set(parameterEnvironmentName, pending)
  try {
    return await pending
  } catch (error) {
    secretCache.delete(parameterEnvironmentName)
    throw error
  }
}

export const runtime = {
  tableName: () => requireEnvironment('TABLE_NAME'),
  businessId: () => process.env.BUSINESS_ID ?? 'default',
  jwtSecret: () => getSecureSecret('JWT_SECRET_PARAMETER_NAME', 32),
  phoneLookupSecret: () => getSecureSecret('PHONE_LOOKUP_SECRET_PARAMETER_NAME', 32),
}

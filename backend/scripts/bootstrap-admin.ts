import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const region = process.env.AWS_REGION ?? 'ap-south-2'
const stage = process.env.STAGE ?? 'dev'
const businessId = process.env.BUSINESS_ID ?? 'default'
const tableName = process.env.TABLE_NAME ?? `agaram-finance-${stage}`

async function main() {
  process.env.AWS_REGION = region
  process.env.TABLE_NAME = tableName
  process.env.BUSINESS_ID = businessId
  process.env.JWT_SECRET_PARAMETER_NAME = `/agaram-finance/${stage}/JWT_SECRET`
  process.env.PHONE_LOOKUP_SECRET_PARAMETER_NAME = `/agaram-finance/${stage}/PHONE_LOOKUP_SECRET`

  const terminal = createInterface({ input: stdin, output: stdout })
  const name = (await terminal.question('Administrator name: ')).trim()
  const phone = (await terminal.question('Administrator phone (include country code): ')).trim()
  terminal.close()
  if (name.length < 2 || name.length > 100) throw new Error('Administrator name must be between 2 and 100 characters.')
  const password = await readHidden('Initial admin password (12+ characters): ')
  const confirmation = await readHidden('Confirm initial admin password: ')
  if (password !== confirmation) throw new Error('Passwords do not match.')

  const [{ AuthService }, { TableRepository }, { createAuditRecord }] = await Promise.all([
    import('../src/services/auth-service.js'),
    import('../src/repositories/table-repository.js'),
    import('../src/services/audit-service.js'),
  ])
  const repository = new TableRepository()
  const bootstrapKey = { PK: `BUSINESS#${businessId}`, SK: 'ADMIN_BOOTSTRAPPED' }
  if (await repository.get(bootstrapKey)) {
    throw new Error('The first admin has already been bootstrapped for this business.')
  }

  const auth = new AuthService(repository)
  const prepared = await auth.prepareUser({
    phone,
    password,
    role: 'ADMIN',
    name,
    passwordChangeRequired: false,
  })
  const now = new Date().toISOString()
  const audit = createAuditRecord({
    actorUserId: 'SYSTEM_BOOTSTRAP',
    action: 'initial_admin_created',
    entityType: 'USER',
    entityId: String(prepared.user.userId),
    requestId: 'local-bootstrap',
    occurredAt: now,
  })
  try {
    await repository.transact({
      TransactItems: [
        { Put: { TableName: tableName, Item: prepared.phoneMapping, ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: tableName, Item: prepared.user, ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: tableName, Item: { ...bootstrapKey, entityType: 'ADMIN_BOOTSTRAP', createdAt: now }, ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: tableName, Item: audit } },
      ],
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException')) {
      throw new Error('Bootstrap was not completed: the admin already exists or the bootstrap was already used.')
    }
    throw error
  }

  stdout.write(`Initial administrator created for ${prepared.user.phone}.\n`)
}

function readHidden(prompt: string) {
  if (!stdin.isTTY) throw new Error('Run this command in an interactive terminal so the password is not echoed.')
  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise<string>((resolve, reject) => {
    let value = ''
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup()
          reject(new Error('Bootstrap cancelled.'))
          return
        }
        if (char === '\r' || char === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
        } else {
          value += char
        }
      }
    }
    const cleanup = () => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
    }
    stdin.on('data', onData)
  })
}

main().catch((error: unknown) => {
  stdout.write(`${error instanceof Error ? error.message : 'Bootstrap failed.'}\n`)
  process.exitCode = 1
})

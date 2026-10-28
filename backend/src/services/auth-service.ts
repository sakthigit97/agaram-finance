import { randomBytes, createHmac } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { runtime } from '../config/runtime.js'
import { displayPhone, legacyPhoneCandidates, normalizeLocalPhone, phoneLookupKey } from '../domain/phone.js'
import { createId } from '../domain/ids.js'
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../errors/app-error.js'
import { isConditionalFailure, TableRepository, type TableItem } from '../repositories/table-repository.js'
import { createAuditRecord } from './audit-service.js'

const roles = ['ADMIN', 'STAFF', 'CUSTOMER'] as const
export type UserRole = (typeof roles)[number]

export interface Principal {
  userId: string
  role: UserRole
  customerId?: string
  passwordChangeRequired: boolean
}

interface UserRecord extends TableItem {
  entityType: 'USER'
  userId: string
  phone: string
  role: UserRole
  passwordHash: string
  status: 'ACTIVE' | 'DISABLED'
  passwordChangeRequired: boolean
  version: number
  customerId?: string
  staffId?: string
}

export class AuthService {
  constructor(private readonly repository: TableRepository) {}

  normalizePhone(value: string) {
    return normalizeLocalPhone(value)
  }

  async createUser(input: {
    phone: string
    password: string
    role: UserRole
    name: string
    actorUserId: string
    requestId: string
    customerId?: string
    staffId?: string
    passwordChangeRequired?: boolean
  }) {
    const prepared = await this.prepareUser(input)
    const audit = createAuditRecord({
      actorUserId: input.actorUserId,
      action: `${input.role.toLowerCase()}_account_created`,
      entityType: 'USER',
      entityId: prepared.user.userId,
      requestId: input.requestId,
      occurredAt: prepared.user.createdAt as string,
    })
    try {
      await this.repository.transact({
        TransactItems: [
          { Put: { TableName: process.env.TABLE_NAME, Item: prepared.phoneMapping, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: prepared.user, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('A user with this phone number already exists.', 'PHONE_ALREADY_EXISTS')
      throw error
    }
    return { userId: prepared.user.userId as string, phone: prepared.user.phone as string, role: input.role }
  }

  async prepareUser(input: {
    phone: string
    password: string
    role: UserRole
    name: string
    customerId?: string
    staffId?: string
    passwordChangeRequired?: boolean
  }) {
    const phone = normalizeLocalPhone(input.phone)
    const phoneSecret = await runtime.phoneLookupSecret()
    const existingMappings = await Promise.all(legacyPhoneCandidates(phone).map((candidate) =>
      this.repository.get<TableItem>({
        PK: `PHONE#${phoneLookupKey(candidate, phoneSecret)}`,
        SK: 'USER',
      }),
    ))
    if (existingMappings.some(Boolean)) {
      throw conflict('A user with this phone number already exists.', 'PHONE_ALREADY_EXISTS')
    }
    validatePassword(input.password)
    const userId = input.customerId ?? input.staffId ?? createId('usr')
    const passwordHash = await hash(input.password, 12)
    const now = new Date().toISOString()
    const user: UserRecord = {
      PK: `USER#${userId}`,
      SK: 'PROFILE',
      entityType: 'USER',
      businessId: runtime.businessId(),
      userId,
      name: input.name,
      phone,
      role: input.role,
      passwordHash,
      status: 'ACTIVE',
      passwordChangeRequired: input.passwordChangeRequired ?? false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.staffId ? { staffId: input.staffId } : {}),
    }
    const phoneMapping: TableItem = {
      PK: `PHONE#${phoneLookupKey(phone, await runtime.phoneLookupSecret())}`,
      SK: 'USER',
      entityType: 'PHONE_LOOKUP',
      businessId: runtime.businessId(),
      userId,
      createdAt: now,
    }
    return { user, phoneMapping }
  }

  async authenticate(phoneInput: string, password: string, sourceIp: string) {
    const phone = normalizeLocalPhone(phoneInput)
    await this.consumeLoginAttempt(phone, sourceIp)
    const phoneSecret = await runtime.phoneLookupSecret()
    let mapping: TableItem | undefined
    for (const candidate of legacyPhoneCandidates(phone)) {
      mapping = await this.repository.get<TableItem>({
        PK: `PHONE#${phoneLookupKey(candidate, phoneSecret)}`,
        SK: 'USER',
      })
      if (mapping) break
    }
    const user = mapping?.userId
      ? await this.getUserById(String(mapping.userId))
      : undefined
    const suppliedPasswordIsValid = Buffer.byteLength(password, 'utf8') <= 72
    const passwordMatches = suppliedPasswordIsValid && user
      ? await compare(password, user.passwordHash)
      : await compare(password, '$2a$12$zKX3pP8L5hdP2O6/FXwoLeYW/XmWpZ8Zyix2j87hIsVmZWG7xVuau')
    if (!user || user.status !== 'ACTIVE' || !suppliedPasswordIsValid || !passwordMatches) throw unauthorized()

    const principal: Principal = {
      userId: user.userId,
      role: user.role,
      passwordChangeRequired: user.passwordChangeRequired,
      ...(user.customerId ? { customerId: user.customerId } : {}),
    }
    const accessToken = await new SignJWT({
      role: principal.role,
      customerId: principal.customerId,
      passwordChangeRequired: principal.passwordChangeRequired,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(principal.userId)
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(await runtime.jwtSecret())
    return { accessToken, expiresIn: 86_400, principal: toPublicPrincipal(principal, user.name, user.phone) }
  }

  async authenticateToken(token: string): Promise<Principal> {
    let userId: string | undefined
    let role: string | undefined
    try {
      const { payload } = await jwtVerify(token, await runtime.jwtSecret(), { algorithms: ['HS256'] })
      userId = payload.sub
      role = typeof payload.role === 'string' ? payload.role : undefined
    } catch {
      throw unauthorized()
    }
    if (!userId || !role || !roles.includes(role as UserRole)) throw unauthorized()
    const user = await this.getUserById(userId)
    if (!user || user.status !== 'ACTIVE' || user.role !== role) throw unauthorized()
    return {
      userId,
      role: user.role,
      passwordChangeRequired: user.passwordChangeRequired,
      ...(user.customerId ? { customerId: user.customerId } : {}),
    }
  }

  async getUserById(userId: string) {
    return this.repository.get<UserRecord>({ PK: `USER#${userId}`, SK: 'PROFILE' })
  }

  async getPublicUser(userId: string) {
    const user = await this.getUserById(userId)
    if (!user || user.status !== 'ACTIVE') throw unauthorized()
    return toPublicPrincipal({
      userId: user.userId,
      role: user.role,
      passwordChangeRequired: user.passwordChangeRequired,
      ...(user.customerId ? { customerId: user.customerId } : {}),
    }, user.name, user.phone)
  }

  async changePassword(
    principal: Principal,
    input: { currentPassword: string; newPassword: string },
    requestId: string,
  ) {
    if (principal.role === 'CUSTOMER' && !principal.passwordChangeRequired) throw forbidden()
    validatePassword(input.newPassword)
    const user = await this.getUserById(principal.userId)
    if (!user || user.status !== 'ACTIVE' || !await compare(input.currentPassword, user.passwordHash)) {
      throw unauthorized()
    }
    const passwordHash = await hash(input.newPassword, 12)
    const now = new Date().toISOString()
    const audit = createAuditRecord({
      actorUserId: principal.userId,
      action: 'password_changed',
      entityType: 'USER',
      entityId: principal.userId,
      requestId,
      occurredAt: now,
    })
    try {
      await this.repository.transact({
        TransactItems: [
          {
            Update: {
              TableName: process.env.TABLE_NAME,
              Key: { PK: `USER#${principal.userId}`, SK: 'PROFILE' },
              UpdateExpression: 'SET passwordHash = :passwordHash, passwordChangeRequired = :false, updatedAt = :updatedAt, #version = #version + :one',
              ConditionExpression: '#version = :version AND #status = :active',
              ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
              ExpressionAttributeValues: {
                ':passwordHash': passwordHash,
                ':false': false,
                ':updatedAt': now,
                ':one': 1,
                ':version': user.version,
                ':active': 'ACTIVE',
              },
            },
          },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('Password changed in another request. Sign in again.')
      throw error
    }
  }

  async resetPassword(
    userId: string,
    actor: Principal,
    requestId: string,
  ) {
    if (actor.role !== 'ADMIN') throw forbidden()
    const user = await this.getUserById(userId)
    if (!user || user.status !== 'ACTIVE') throw unauthorized()
    const temporaryPassword = this.createTemporaryPassword(user.role)
    const newPassword = temporaryPassword
    validatePassword(newPassword)
    const passwordHash = await hash(newPassword, 12)
    const now = new Date().toISOString()
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'password_reset_by_admin',
      entityType: 'USER',
      entityId: userId,
      requestId,
      occurredAt: now,
    })
    try {
      await this.repository.transact({
        TransactItems: [
          {
            Update: {
              TableName: process.env.TABLE_NAME,
              Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
              UpdateExpression: 'SET passwordHash = :passwordHash, passwordChangeRequired = :true, updatedAt = :updatedAt, #version = #version + :one',
              ConditionExpression: '#version = :version AND #status = :active',
              ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
              ExpressionAttributeValues: {
                ':passwordHash': passwordHash,
                ':true': true,
                ':updatedAt': now,
                ':one': 1,
                ':version': user.version,
                ':active': 'ACTIVE',
              },
            },
          },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('Account changed while resetting the password. Refresh and try again.')
      throw error
    }
    return { temporaryPassword }
  }

  createTemporaryPassword(role: UserRole = 'ADMIN') {
    const prefix = role === 'CUSTOMER' ? 'customer@Agaram-' : role === 'STAFF' ? 'agent@Agaram-' : 'admin@Agaram-'
    return `${prefix}${randomBytes(12).toString('base64url')}`
  }

  private async consumeLoginAttempt(phone: string, sourceIp: string) {
    const minute = Math.floor(Date.now() / 60_000)
    const hashKey = createHmac('sha256', await runtime.phoneLookupSecret())
      .update(`${phone}|${sourceIp}`)
      .digest('hex')
    try {
      await this.repository.update(
        { PK: `LOGIN#${hashKey}`, SK: `MINUTE#${minute}` },
        'SET attempts = if_not_exists(attempts, :zero) + :one, expiresAt = :expiresAt',
        { ':zero': 0, ':one': 1, ':expiresAt': Math.floor(Date.now() / 1000) + 300, ':limit': 5 },
        'attribute_not_exists(attempts) OR attempts < :limit',
      )
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new AppError(
          429,
          'RATE_LIMITED',
          'Too many login attempts. Try again in a minute.',
        )
      }
      throw error
    }
  }
}

export function validatePassword(password: string) {
  const byteLength = typeof password === 'string' ? Buffer.byteLength(password, 'utf8') : 0
  if (typeof password !== 'string' || password.length < 12 || byteLength > 72) {
    throw badRequest('Password must be at least 12 characters and no more than 72 UTF-8 bytes.')
  }
}

function toPublicPrincipal(principal: Principal, name: string, phone: string) {
  return {
    userId: principal.userId,
    name,
    phone: displayPhone(phone),
    role: principal.role,
    passwordChangeRequired: principal.passwordChangeRequired,
    ...(principal.customerId ? { customerId: principal.customerId } : {}),
  }
}

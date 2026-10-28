import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb'
import type { NativeAttributeValue } from '@aws-sdk/lib-dynamodb'

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

export type TableItem = Record<string, NativeAttributeValue> & { PK: string; SK: string }

export class TableRepository {
  constructor(
    private readonly db = client,
    private readonly tableName = process.env.TABLE_NAME ?? '',
  ) {}

  get<T extends TableItem>(key: Pick<TableItem, 'PK' | 'SK'>, consistentRead = true) {
    this.assertTableConfigured()
    return this.db.send(new GetCommand({
      TableName: this.tableName,
      Key: key,
      ConsistentRead: consistentRead,
    })).then((result) => result.Item as T | undefined)
  }

  put(item: TableItem, conditionExpression?: string) {
    this.assertTableConfigured()
    return this.db.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ...(conditionExpression ? { ConditionExpression: conditionExpression } : {}),
    }))
  }

  update(
    key: Pick<TableItem, 'PK' | 'SK'>,
    updateExpression: string,
    values: Record<string, unknown>,
    conditionExpression?: string,
    names?: Record<string, string>,
  ) {
    this.assertTableConfigured()
    return this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: values,
      ...(conditionExpression ? { ConditionExpression: conditionExpression } : {}),
      ...(names ? { ExpressionAttributeNames: names } : {}),
      ReturnValues: 'ALL_NEW',
    })).then((result) => result.Attributes as TableItem | undefined)
  }

  query(input: Omit<QueryCommandInput, 'TableName'>) {
    this.assertTableConfigured()
    return this.db.send(new QueryCommand({ ...input, TableName: this.tableName }))
  }

  transact(input: TransactWriteCommandInput) {
    this.assertTableConfigured()
    return this.db.send(new TransactWriteCommand(input))
  }

  async nextBusinessId(businessId: string, entity: 'CUSTOMER' | 'LOAN' | 'TRANSACTION' | 'STAFF') {
    this.assertTableConfigured()
    const result = await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: `ID_COUNTER#${businessId}`, SK: entity },
      UpdateExpression: 'ADD #sequence :one',
      ExpressionAttributeNames: { '#sequence': 'sequence' },
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'ALL_NEW',
    }))
    const sequence = result.Attributes?.sequence
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error(`Could not allocate the next ${entity.toLowerCase()} ID.`)
    }
    const prefix = entity === 'CUSTOMER' ? 'CUS'
      : entity === 'LOAN' ? 'LOAN'
        : entity === 'TRANSACTION' ? 'TRNS' : 'AGNT'
    return `${prefix}${String(sequence).padStart(3, '0')}`
  }

  private assertTableConfigured() {
    if (!this.tableName) throw new Error('Required environment variable TABLE_NAME is not configured.')
  }
}

export function isConditionalFailure(error: unknown) {
  return typeof error === 'object' && error !== null
    && 'name' in error
    && (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException')
}

export function isMissingTable(error: unknown) {
  return typeof error === 'object' && error !== null
    && 'name' in error
    && error.name === 'ResourceNotFoundException'
}

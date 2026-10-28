import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

export async function handler(): Promise<APIGatewayProxyStructuredResultV2> {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ status: 'ok', service: 'agaram-finance-api' }),
  }
}

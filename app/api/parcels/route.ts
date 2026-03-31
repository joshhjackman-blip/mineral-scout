import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const filePath = path.join(process.cwd(), 'public', 'gonzales_parcels_enriched.geojson')
  const data = fs.readFileSync(filePath, 'utf8')
  return new NextResponse(data, {
    headers: { 'Content-Type': 'application/json' },
  })
}

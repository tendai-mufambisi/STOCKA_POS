import { getSupabaseClient, isCloudConfigured } from './supabaseClient'
import {
  getDb,
  saveDb,
  getProducts,
  addOrUpdateProductFromSync,
  markProductsSynced,
  logSyncConflict,
  createSyncBackup,
  getSyncPreview
} from '../database/db'

const toIso = () => new Date().toISOString()

const mapLocalProductToCloud = (product, shopId) => ({
  external_id: product.external_id || `product-${product.id}`,
  shop_id: shopId,
  name: product.name,
  category: product.category || null,
  unit: product.unit || 'each',
  reorder_level: product.reorder_level || 0,
  description: product.description || null,
  current_quantity: product.current_quantity || 0,
  image_data: product.image_data || null,
  source: 'desktop',
  updated_at: product.sync_updated_at || toIso(),
  version: product.sync_version || 1
})

export const canSyncToCloud = () => isCloudConfigured()

export const previewSync = async () => {
  const localPreview = await getSyncPreview()
  return {
    ...localPreview,
    cloudConfigured: canSyncToCloud()
  }
}

export const pushLocalChangesToCloud = async ({ shopId, actor }) => {
  if (!shopId) throw new Error('shopId is required for cloud sync')
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured')

  await createSyncBackup(`push-${toIso()}`)
  const products = await getProducts()
  const dirtyProducts = products.filter(p => p.sync_dirty === 1)
  
  if (!dirtyProducts.length) {
    return { pushed: 0, conflicts: 0, skipped: 0 }
  }

  // Map products to cloud format
  const payload = dirtyProducts.map(p => mapLocalProductToCloud(p, shopId))
  
  // Remove duplicates by external_id (keep the latest)
  const deduplicated = Array.from(
    new Map(payload.map(item => [item.external_id, item])).values()
  )

  const { data, error } = await supabase
    .from('products')
    .upsert(deduplicated, { onConflict: 'external_id,shop_id' })
    .select('external_id, version')

  if (error) throw error

  const syncedExternalIds = (data || []).map(row => row.external_id)
  await markProductsSynced(syncedExternalIds, actor || 'desktop')
  saveDb()

  return { 
    pushed: syncedExternalIds.length, 
    conflicts: 0, 
    skipped: dirtyProducts.length - syncedExternalIds.length 
  }
}

export const pullCloudChangesToLocal = async ({ shopId, actor }) => {
  if (!shopId) throw new Error('shopId is required for cloud sync')
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured')

  await createSyncBackup(`pull-${toIso()}`)
  
  // Get products from cloud, ordered by most recently updated
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('shop_id', shopId)
    .order('updated_at', { ascending: false })

  if (error) throw error

  const database = await getDb()
  
  // Get all local products to check for duplicates (check by external_id or name)
  const localProducts = []
  const stmt = database.prepare('SELECT external_id, id, name, shop_id FROM products')
  while (stmt.step()) {
    localProducts.push(stmt.getAsObject())
  }
  stmt.free()
  
  // Create maps for quick lookup - both by external_id and by name
  const localByExternalId = new Map(localProducts.map(p => [p.external_id, p]))
  const localByName = new Map(localProducts.map(p => [p.name?.toLowerCase(), p]))

  let imported = 0
  let updated = 0
  let skipped = 0
  let conflicts = 0
  
  for (const cloudProduct of data || []) {
    // Try to find local product by external_id first, then by name as fallback
    let localProduct = cloudProduct.external_id ? localByExternalId.get(cloudProduct.external_id) : null
    
    if (!localProduct && cloudProduct.name) {
      localProduct = localByName.get(cloudProduct.name.toLowerCase())
    }
    
    if (localProduct) {
      // Product exists locally - check if cloud version is newer
      const result = await addOrUpdateProductFromSync(cloudProduct, actor || 'cloud')
      if (result?.status === 'conflict') {
        conflicts += 1
        await logSyncConflict({
          entity_type: 'product',
          external_id: cloudProduct.external_id,
          local_payload: result.localPayload,
          cloud_payload: cloudProduct,
          resolution: 'cloud_override'
        })
      } else if (result?.status === 'updated') {
        updated += 1
      } else {
        skipped += 1
      }
    } else {
      // NEW product from cloud - import it
      const result = await addOrUpdateProductFromSync(cloudProduct, actor || 'cloud')
      if (result?.status === 'imported') {
        imported += 1
      } else if (result?.status === 'conflict') {
        conflicts += 1
      }
    }
  }

  database.run(
    `INSERT INTO sync_audit_log (action, actor, details, created_at)
     VALUES (?, ?, ?, ?)`,
    ['pull', actor || 'cloud', JSON.stringify({ imported, updated, skipped, conflicts }), toIso()]
  )
  saveDb()

  return { imported, updated, skipped, conflicts }
}

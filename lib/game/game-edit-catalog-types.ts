export type CatalogEntry = {
  id: number
  name: string
  description?: string
}

export type GameEditCatalog = {
  ok: true
  contentRoot: string
  source: 'disk' | 'empty'
  items: CatalogEntry[]
  weapons: CatalogEntry[]
  armors: CatalogEntry[]
  variables: CatalogEntry[]
  switches: CatalogEntry[]
  actors: CatalogEntry[]
  skills: CatalogEntry[]
  states: CatalogEntry[]
  classes: CatalogEntry[]
}

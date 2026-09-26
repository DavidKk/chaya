/** RPG Maker 数据库可见文本字段，Web 抽取与局内抽取共用。 */
export const DB_SPECS: [string, string[], string][] = [
  ['Actors.json', ['name', 'nickname', 'profile'], 'actors'],
  ['Classes.json', ['name'], 'classes'],
  ['Skills.json', ['name', 'description', 'message1', 'message2'], 'skills'],
  ['Items.json', ['name', 'description'], 'items'],
  ['Weapons.json', ['name', 'description'], 'weapons'],
  ['Armors.json', ['name', 'description'], 'armors'],
  ['Enemies.json', ['name'], 'enemies'],
  ['States.json', ['name', 'message1', 'message2', 'message3', 'message4'], 'states'],
]

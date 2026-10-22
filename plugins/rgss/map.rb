module ChayaRGSS
  module MapView
    def self.detail(id)
      raise 'Only the current RGSS map is available' unless $game_map && $game_map.map_id == id
      map = $game_map.instance_variable_get(:@map)
      raise 'Map data is not ready' unless map
      active = {}
      events = $game_map.events.values.map do |live|
        event = live.instance_variable_get(:@event)
        next unless event
        page = live.instance_variable_get(:@page)
        active[event.id] = page ? (event.pages.index(page) || -1) + 1 : 0
        { 'id' => event.id, 'name' => event.name.to_s, 'rawName' => event.name.to_s, 'x' => live.x, 'y' => live.y,
          'type' => 'other', 'pages' => event.pages.map { |item|
            { 'conditions' => {}, 'trigger' => item.trigger, 'list' => [], 'commandCount' => item.list.size,
              'characterName' => item.graphic.character_name.to_s, 'tileId' => item.graphic.tile_id }
          } }
      end.compact
      { 'ok' => true, 'source' => 'live', 'mapId' => id, 'name' => '', 'displayName' => map.respond_to?(:display_name) ? map.display_name : '',
        'width' => map.width, 'height' => map.height, 'events' => events, 'texts' => {}, 'encounters' => [],
        'encounterStep' => map.encounter_step, 'live' => { 'onThisMap' => true, 'activePage' => active, 'selfSwitches' => {} } }
    end
  end
end

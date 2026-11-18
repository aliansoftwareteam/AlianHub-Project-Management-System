import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import ConnectorTile from '@/views/Integrations/ConnectorTile.vue';

const CATALOG = ['canva', 'dropbox', 'github', 'google', 'hubspot', 'notion', 'outlook', 'slack', 'supabase', 'upwork', 'wisprflow'];

describe('the connector tile', () => {
    it.each(CATALOG)('shows the official %s logo on its light plate', (provider) => {
        const tile = mount(ConnectorTile, { props: { provider, name: provider } });
        expect(tile.classes()).toContain('cx-tile--logo');
        expect(tile.find('img').attributes('src')).toMatch(new RegExp(provider));
        expect(tile.find('img').attributes('alt')).toBe('');
        expect(tile.find('.cx-tile__initials').exists()).toBe(false);
    });

    it('keeps the initials of a custom server, which has no logo', () => {
        const tile = mount(ConnectorTile, { props: { provider: 'custom_6f01', name: 'Team notes' } });
        expect(tile.find('img').exists()).toBe(false);
        expect(tile.find('.cx-tile__initials').text()).toBe('TN');
    });
});

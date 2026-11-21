import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppQueryClient } from './query-client';

afterEach(() => onlineManager.setOnline(true));

describe('the app query client while the system is offline', () => {
    it('still reads and writes: both reach the local backend', async () => {
        onlineManager.setOnline(false);
        const client = createAppQueryClient();
        await expect(
            client.fetchQuery({ queryKey: ['local'], queryFn: async () => 'read' }),
        ).resolves.toBe('read');
        const mutation = client
            .getMutationCache()
            .build(client, { mutationFn: async () => 'switched' });
        await expect(mutation.execute(undefined)).resolves.toBe('switched');
    });
});

import dotenv from 'dotenv';

// Keep Render/deployment variables authoritative when a local .env also exists.
dotenv.config();

// This value is stored in the existing `local` column for backwards
// compatibility with the current Supabase/SQLite schema. It remains the
// legacy account value; new Mercado branches use the same prefix below.
export const RECIPIENT_ACCOUNT_MERCADO_FRESCOS = 'mercado_frescos';

// Branches used only by the Mercado de Frescos account. The legacy account
// value above is intentionally kept for old rows that were saved before the
// branch split was introduced.
export const MERCADO_FRESCOS_BRANCHES = Object.freeze([
    {
        id: 'mercado_frescos_merlo',
        label: 'Merlo',
        senderNumber: '3516161274',
        icon: 'fa-store'
    },
    {
        id: 'mercado_frescos_villa_dolores',
        label: 'Villa Dolores',
        senderNumber: '3516161285',
        icon: 'fa-store'
    },
    {
        id: 'mercado_frescos_mina_clavero',
        label: 'Mina Clavero',
        senderNumber: '3512327471',
        icon: 'fa-store'
    },
    {
        id: 'mercado_frescos_repartos',
        label: 'Repartos',
        senderNumber: null,
        icon: 'fa-truck'
    }
]);

export const MERCADO_FRESCOS_UNASSIGNED_LOCAL = 'mercado_frescos_sin_asignar';

export function normalizeCuit(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
}

export function isMercadoFrescosLocal(local) {
    const value = String(local || '');
    return value === RECIPIENT_ACCOUNT_MERCADO_FRESCOS ||
        value.startsWith(`${RECIPIENT_ACCOUNT_MERCADO_FRESCOS}_`);
}

export function getMercadoFrescosBranch(local) {
    return MERCADO_FRESCOS_BRANCHES.find(branch => branch.id === local) || null;
}

/**
 * Resolves a Mercado de Frescos sender using the phone number, including
 * WhatsApp JIDs and the country-code form returned after LID resolution.
 */
export function getMercadoFrescosBranchForSender(sender) {
    const senderDigits = String(sender || '').replace(/\D/g, '');
    if (!senderDigits) return null;

    return MERCADO_FRESCOS_BRANCHES.find(branch =>
        branch.senderNumber && senderDigits.endsWith(branch.senderNumber)
    ) || null;
}

function normalizeRecipientText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function meaningfulTokens(value) {
    return normalizeRecipientText(value)
        .split(' ')
        .filter(token => token && !['sa', 's', 'a'].includes(token));
}

export function getRecipientAccounts() {
    return [
        {
            id: 'abasto',
            label: 'Abasto del Campo',
            alias: (process.env.RECIPIENT_ALIAS || 'Abasto Del Campo Sa').trim(),
            cuit: normalizeCuit(process.env.RECIPIENT_CUIT || '30-71425462-2'),
            storageValue: null
        },
        {
            id: RECIPIENT_ACCOUNT_MERCADO_FRESCOS,
            label: 'Mercado de Frescos',
            alias: (process.env.RECIPIENT_ALIAS_MERCADO_FRESCOS || 'Mercado de Frescos Sa').trim(),
            cuit: normalizeCuit(process.env.RECIPIENT_CUIT_MERCADO_FRESCOS || '30-71729082-4'),
            storageValue: RECIPIENT_ACCOUNT_MERCADO_FRESCOS
        }
    ].filter(account => account.alias);
}

/**
 * Finds the configured recipient account from OCR's destinatario value.
 * The comparison accepts legal-suffix differences such as "SA" / "S.A." and
 * harmless extra OCR text, while requiring every meaningful alias token.
 * If the alias is missing or does not match, the recipient CUIT is used as a
 * second identification path and accepts formatted or unformatted values.
 */
export function identifyRecipientAccount(destinatario, cuit) {
    const destinationTokens = meaningfulTokens(destinatario);
    const normalizedDestination = normalizeRecipientText(destinatario);
    const accounts = getRecipientAccounts();
    const accountByAlias = accounts.find(account => {
        const normalizedAlias = normalizeRecipientText(account.alias);
        const aliasTokens = meaningfulTokens(account.alias);
        return destinationTokens.length > 0 && (
            normalizedDestination === normalizedAlias ||
            aliasTokens.length > 0 && aliasTokens.every(token => destinationTokens.includes(token))
        );
    });
    if (accountByAlias) return accountByAlias;

    const normalizedCuit = normalizeCuit(cuit);
    if (!normalizedCuit) return null;

    return accounts.find(account => account.cuit === normalizedCuit) || null;
}

export function isMercadoFrescosReceipt(receipt) {
    return isMercadoFrescosLocal(receipt?.local);
}

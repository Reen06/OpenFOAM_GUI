/**
 * Unit Formatter Module
 * 
 * Provides formatting utilities for engineering units with:
 * - Auto-prefix scaling (mN, μN, kN, etc.)
 * - Unit system conversion (N ↔ lbf, Nm ↔ ft·lbf)
 * - Scientific notation toggle
 * - Configurable decimal precision
 * - Persistent settings via localStorage
 */

const UnitFormatter = (function () {
    // Default settings
    const DEFAULT_SETTINGS = {
        unitSystem: 'metric',      // 'metric' | 'imperial'
        autoPrefix: true,          // Auto-scale with SI prefixes
        scientificNotation: false, // Use scientific notation
        decimalPlaces: 4,          // Number of significant digits
    };

    // Storage key
    const STORAGE_KEY = 'unitFormatterSettings';

    // SI Prefixes (sorted by magnitude)
    const SI_PREFIXES = [
        { prefix: 'G', factor: 1e9 },
        { prefix: 'M', factor: 1e6 },
        { prefix: 'k', factor: 1e3 },
        { prefix: '', factor: 1 },
        { prefix: 'm', factor: 1e-3 },
        { prefix: 'μ', factor: 1e-6 },
        { prefix: 'n', factor: 1e-9 },
        { prefix: 'p', factor: 1e-12 },
    ];

    // Unit conversion factors
    const CONVERSIONS = {
        // Force: N to lbf
        N: { imperial: 'lbf', factor: 0.224809 },
        // Torque: Nm to ft·lbf
        Nm: { imperial: 'ft·lbf', factor: 0.737562 },
        // Area: m² to ft²
        'm²': { imperial: 'ft²', factor: 10.7639 },
        // Velocity: m/s to ft/s
        'm/s': { imperial: 'ft/s', factor: 3.28084 },
    };

    // Get current settings
    function getSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
            }
        } catch (e) {
            console.warn('Failed to load unit formatter settings:', e);
        }
        return { ...DEFAULT_SETTINGS };
    }

    // Save settings
    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('Failed to save unit formatter settings:', e);
        }
    }

    // Update a single setting
    function updateSetting(key, value) {
        const settings = getSettings();
        settings[key] = value;
        saveSettings(settings);
        return settings;
    }

    // Find best SI prefix for a value
    function findBestPrefix(value) {
        const absValue = Math.abs(value);

        if (absValue === 0) {
            return { prefix: '', factor: 1 };
        }

        // Find the prefix that gives a value between 1 and 999
        for (const p of SI_PREFIXES) {
            const scaled = absValue / p.factor;
            if (scaled >= 1 && scaled < 1000) {
                return p;
            }
        }

        // Edge cases: use nano for very small, Giga for very large
        if (absValue < 1e-9) {
            return { prefix: 'n', factor: 1e-9 };
        }
        if (absValue >= 1e9) {
            return { prefix: 'G', factor: 1e9 };
        }

        return { prefix: '', factor: 1 };
    }

    /**
     * Format a numeric value with units
     * 
     * @param {number} value - The numeric value to format
     * @param {string} unit - The base unit (e.g., 'N', 'Nm', 'm²')
     * @param {object} options - Override default settings
     * @returns {string} Formatted value with units
     */
    function format(value, unit = '', options = {}) {
        const settings = { ...getSettings(), ...options };

        // Handle null/undefined/NaN
        if (value === null || value === undefined || isNaN(value)) {
            return '-';
        }

        let displayValue = value;
        let displayUnit = unit;

        // Apply unit system conversion
        if (settings.unitSystem === 'imperial' && CONVERSIONS[unit]) {
            const conv = CONVERSIONS[unit];
            displayValue = value * conv.factor;
            displayUnit = conv.imperial;
        }

        // Apply auto-prefix scaling (only for metric units, not imperial)
        let prefix = '';
        if (settings.autoPrefix && settings.unitSystem === 'metric' && unit) {
            const prefixInfo = findBestPrefix(displayValue);
            displayValue = displayValue / prefixInfo.factor;
            prefix = prefixInfo.prefix;
        }

        // Format the number
        let formattedNumber;
        if (settings.scientificNotation) {
            formattedNumber = displayValue.toExponential(settings.decimalPlaces - 1);
        } else {
            // Use toPrecision for significant figures
            if (Math.abs(displayValue) >= 1) {
                formattedNumber = displayValue.toFixed(settings.decimalPlaces);
            } else if (displayValue === 0) {
                formattedNumber = '0';
            } else {
                // For small numbers, use enough decimals to show significant figures
                const magnitude = Math.floor(Math.log10(Math.abs(displayValue)));
                const decimals = Math.max(0, settings.decimalPlaces - magnitude - 1);
                formattedNumber = displayValue.toFixed(Math.min(decimals, 10));
            }
        }

        // Combine number, prefix, and unit
        const unitStr = displayUnit ? ` ${prefix}${displayUnit}` : '';
        return `${formattedNumber}${unitStr}`;
    }

    /**
     * Format a force value
     */
    function formatForce(value, options = {}) {
        return format(value, 'N', options);
    }

    /**
     * Format a torque value
     */
    function formatTorque(value, options = {}) {
        return format(value, 'Nm', options);
    }

    /**
     * Format a dimensionless coefficient (Cd, Cl, Kt, Kq, etc.)
     */
    function formatCoefficient(value, options = {}) {
        const settings = { ...getSettings(), ...options };

        if (value === null || value === undefined || isNaN(value)) {
            return '-';
        }

        if (settings.scientificNotation) {
            return value.toExponential(settings.decimalPlaces - 1);
        } else {
            return value.toFixed(settings.decimalPlaces);
        }
    }

    /**
     * Format a percentage value
     */
    function formatPercent(value, options = {}) {
        const settings = { ...getSettings(), ...options };

        if (value === null || value === undefined || isNaN(value)) {
            return '- %';
        }

        return value.toFixed(Math.min(settings.decimalPlaces, 2)) + ' %';
    }

    /**
     * Format area value
     */
    function formatArea(value, options = {}) {
        return format(value, 'm²', options);
    }

    /**
     * Create the display settings UI HTML
     * @param {string} idPrefix - Prefix for element IDs (e.g., 'wt-' or 'prop-')
     */
    function createSettingsHTML(idPrefix = '') {
        const settings = getSettings();

        return `
            <div class="display-settings" style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; margin-bottom: 16px;">
                <span style="color: var(--text-muted); font-size: 0.85em;">Display:</span>
                
                <div class="form-group" style="margin: 0;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85em;">
                        Unit System
                        <select id="${idPrefix}unit-system" style="padding: 4px 8px; font-size: 0.85em;">
                            <option value="metric" ${settings.unitSystem === 'metric' ? 'selected' : ''}>Metric (N, Nm)</option>
                            <option value="imperial" ${settings.unitSystem === 'imperial' ? 'selected' : ''}>Imperial (lbf, ft·lbf)</option>
                        </select>
                    </label>
                </div>

                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85em; cursor: pointer;">
                    <input type="checkbox" id="${idPrefix}auto-prefix" ${settings.autoPrefix ? 'checked' : ''}>
                    Auto-prefix (mN, μN)
                </label>

                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85em; cursor: pointer;">
                    <input type="checkbox" id="${idPrefix}scientific-notation" ${settings.scientificNotation ? 'checked' : ''}>
                    Scientific notation
                </label>

                <div class="form-group" style="margin: 0;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85em;">
                        Decimals
                        <input type="number" id="${idPrefix}decimal-places" value="${settings.decimalPlaces}" 
                               min="1" max="8" style="width: 50px; padding: 4px; font-size: 0.85em;">
                    </label>
                </div>
            </div>
        `;
    }

    /**
     * Attach event listeners to settings controls
     * @param {string} idPrefix - Prefix for element IDs
     * @param {function} onSettingsChange - Callback when settings change
     */
    function attachSettingsListeners(idPrefix = '', onSettingsChange = null) {
        const unitSystemEl = document.getElementById(`${idPrefix}unit-system`);
        const autoPrefixEl = document.getElementById(`${idPrefix}auto-prefix`);
        const scientificEl = document.getElementById(`${idPrefix}scientific-notation`);
        const decimalsEl = document.getElementById(`${idPrefix}decimal-places`);

        console.log('[UnitFormatter] attachSettingsListeners called with prefix:', idPrefix);
        console.log('[UnitFormatter] Found elements:', {
            unitSystem: !!unitSystemEl,
            autoPrefix: !!autoPrefixEl,
            scientific: !!scientificEl,
            decimals: !!decimalsEl
        });

        const handleChange = () => {
            console.log('[UnitFormatter] handleChange triggered!');
            const newSettings = {
                unitSystem: unitSystemEl?.value || 'metric',
                autoPrefix: autoPrefixEl?.checked || false,
                scientificNotation: scientificEl?.checked || false,
                decimalPlaces: parseInt(decimalsEl?.value) || 4,
            };
            console.log('[UnitFormatter] New settings:', newSettings);
            saveSettings(newSettings);
            if (onSettingsChange) {
                console.log('[UnitFormatter] Calling onSettingsChange callback');
                onSettingsChange(newSettings);
            }
        };

        unitSystemEl?.addEventListener('change', handleChange);
        autoPrefixEl?.addEventListener('change', handleChange);
        scientificEl?.addEventListener('change', handleChange);
        decimalsEl?.addEventListener('input', handleChange);

        console.log('[UnitFormatter] Event listeners attached');
    }

    // Public API
    return {
        getSettings,
        saveSettings,
        updateSetting,
        format,
        formatForce,
        formatTorque,
        formatCoefficient,
        formatPercent,
        formatArea,
        createSettingsHTML,
        attachSettingsListeners,
    };
})();

// Export for both browser globals and module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnitFormatter;
} else if (typeof window !== 'undefined') {
    window.UnitFormatter = UnitFormatter;
}

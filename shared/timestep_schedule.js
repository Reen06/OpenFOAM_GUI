/**
 * TimestepSchedule — Shared visual timeline schedule builder
 *
 * Lets users define multiple time segments with different time-stepping modes
 * (fixed deltaT or adaptive Courant-based).
 *
 * Usage:
 *   const schedule = new TimestepSchedule(containerEl, {
 *       endTime: 1.0,
 *       defaultDeltaT: 1e-4,
 *       defaultMaxCo: 0.5,
 *       onChange: (segments) => { ... }
 *   });
 *
 *   // Get current schedule
 *   const segments = schedule.getSchedule();
 *
 *   // Set schedule (e.g. loading saved state)
 *   schedule.setSchedule([...]);
 *
 *   // Update end time when user changes it
 *   schedule.setEndTime(2.0);
 */

class TimestepSchedule {
    constructor(container, options = {}) {
        this.container = container;
        this.endTime = options.endTime || 1.0;
        this.defaultDeltaT = options.defaultDeltaT || 1e-4;
        this.defaultMaxCo = options.defaultMaxCo || 0.5;
        this.onChange = options.onChange || null;
        this.activeIndex = 0;
        this.initialDeltaT = options.defaultDeltaT || 1e-5;

        // Default: single adaptive segment covering full time range
        this.segments = [{
            startTime: 0,
            endTime: this.endTime,
            mode: 'adaptive',
            deltaT: this.defaultDeltaT,
            maxCo: this.defaultMaxCo
        }];

        this._render();
    }

    /** Get the current schedule as an array of segment objects */
    getSchedule() {
        const schedule = JSON.parse(JSON.stringify(this.segments));
        schedule._initialDeltaT = this.initialDeltaT;
        return schedule;
    }

    /** Get the initial delta T value */
    getInitialDeltaT() {
        return this.initialDeltaT;
    }

    /** Set the schedule from saved data */
    setSchedule(segments) {
        if (!segments || !segments.length) return;
        // Restore initialDeltaT if saved
        if (segments._initialDeltaT !== undefined) {
            this.initialDeltaT = parseFloat(segments._initialDeltaT);
        }
        this.segments = segments.filter(s => typeof s === 'object' && s !== null && !Array.isArray(s)).map(s => ({
            startTime: parseFloat(s.startTime) || 0,
            endTime: parseFloat(s.endTime) || this.endTime,
            mode: s.mode || 'adaptive',
            deltaT: parseFloat(s.deltaT) || this.defaultDeltaT,
            maxCo: parseFloat(s.maxCo) || this.defaultMaxCo
        }));
        this.activeIndex = Math.min(this.activeIndex, this.segments.length - 1);
        this._render();
    }

    /** Update the end time (e.g. when user changes the End Time input) */
    setEndTime(newEnd) {
        if (newEnd <= 0) return;
        this.endTime = newEnd;
        // Adjust last segment to match
        const last = this.segments[this.segments.length - 1];
        last.endTime = newEnd;
        // Clamp any segments that exceed new end
        for (let i = 0; i < this.segments.length; i++) {
            if (this.segments[i].startTime >= newEnd) {
                this.segments.splice(i);
                break;
            }
            if (this.segments[i].endTime > newEnd) {
                this.segments[i].endTime = newEnd;
                this.segments.splice(i + 1);
                break;
            }
        }
        this.activeIndex = Math.min(this.activeIndex, this.segments.length - 1);
        this._render();
    }

    /** Destroy the widget */
    destroy() {
        this.container.innerHTML = '';
    }

    // ---- Add / Remove ----

    _addSegment() {
        // Split the last segment at its midpoint
        const last = this.segments[this.segments.length - 1];
        const mid = (last.startTime + last.endTime) / 2;

        // Determine the new segment's mode: opposite of the last
        const newMode = last.mode === 'adaptive' ? 'fixed' : 'adaptive';

        const newSeg = {
            startTime: mid,
            endTime: last.endTime,
            mode: newMode,
            deltaT: this.defaultDeltaT,
            maxCo: this.defaultMaxCo
        };
        last.endTime = mid;
        this.segments.push(newSeg);
        this.activeIndex = this.segments.length - 1;
        this._render();
        this._emitChange();
    }

    _removeSegment(index) {
        if (this.segments.length <= 1) return;

        const removed = this.segments[index];
        if (index === 0) {
            // Merge into next
            this.segments[1].startTime = removed.startTime;
        } else {
            // Merge into previous
            this.segments[index - 1].endTime = removed.endTime;
        }
        this.segments.splice(index, 1);
        this.activeIndex = Math.min(this.activeIndex, this.segments.length - 1);
        this._render();
        this._emitChange();
    }

    // ---- Update helpers ----

    _updateSegmentEndTime(index, newEnd) {
        const seg = this.segments[index];
        newEnd = parseFloat(newEnd);
        if (isNaN(newEnd)) return;

        // Clamp bounds
        const minEnd = seg.startTime + 1e-10;
        const maxEnd = (index < this.segments.length - 1)
            ? this.segments[this.segments.length - 1].endTime
            : this.endTime;

        newEnd = Math.max(minEnd, Math.min(newEnd, maxEnd));

        // Adjust this and subsequent segments
        seg.endTime = newEnd;
        if (index < this.segments.length - 1) {
            this.segments[index + 1].startTime = newEnd;
        }

        this._render();
        this._emitChange();
    }

    _updateSegmentMode(index, mode) {
        this.segments[index].mode = mode;
        this._render();
        this._emitChange();
    }

    _updateSegmentParam(index, key, value) {
        const v = parseFloat(value);
        if (isNaN(v) || v <= 0) return;
        this.segments[index][key] = v;
        this._emitChange();
    }

    _emitChange() {
        if (this.onChange) {
            this.onChange(this.getSchedule());
        }
    }

    // ---- Format helpers ----

    _fmtTime(t) {
        if (t === 0) return '0';
        if (t >= 1) return t.toFixed(2).replace(/\.?0+$/, '') + 's';
        if (t >= 0.001) return (t * 1000).toFixed(1).replace(/\.?0+$/, '') + 'ms';
        if (t >= 1e-6) return (t * 1e6).toFixed(1).replace(/\.?0+$/, '') + 'µs';
        return t.toExponential(1) + 's';
    }

    _fmtDeltaT(dt) {
        if (dt >= 0.01) return dt.toString();
        return dt.toExponential(1);
    }

    // ---- Render ----

    _render() {
        const html = `
            <div class="ts-schedule">
                <div class="ts-schedule-header">
                    <h4>⏱ Time-Step Schedule</h4>
                    <span style="font-size: 0.8em; color: var(--text-muted, #888);">
                        ${this.segments.length} segment${this.segments.length > 1 ? 's' : ''} · 0 → ${this._fmtTime(this.endTime)}
                    </span>
                </div>

                <div class="ts-initial-dt" style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin-bottom: 8px; background: rgba(77,171,247,0.08); border: 1px solid rgba(77,171,247,0.2); border-radius: 6px;">
                    <label style="font-size: 0.85em; white-space: nowrap; font-weight: 600; color: var(--text-primary, #eee);">
                        Initial Δt
                    </label>
                    <input type="number" id="ts-initial-dt" value="${this.initialDeltaT}"
                           step="1e-6" style="width: 120px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color, #444); background: var(--surface-color, #2a2a2e); color: var(--text-primary, #eee); font-size: 0.85em;">
                    <span style="font-size: 0.75em; color: var(--text-muted, #888);">
                        Starting timestep for the first simulation step
                    </span>
                </div>

                ${this._renderTimeline()}
                ${this._renderSegmentList()}

                <button class="ts-add-segment" id="ts-add-btn">
                    + Add Segment
                </button>

                <div class="ts-validation" id="ts-validation"></div>
            </div>
        `;

        this.container.innerHTML = html;
        this._attachEvents();
        this._validate();
    }

    _renderTimeline() {
        const bars = this.segments.map((seg, i) => {
            const pct = ((seg.endTime - seg.startTime) / this.endTime * 100).toFixed(2);
            const label = seg.mode === 'fixed'
                ? `Δt=${this._fmtDeltaT(seg.deltaT)}`
                : `Adaptive`;
            const activeClass = i === this.activeIndex ? ' active' : '';
            return `<div class="ts-segment-bar mode-${seg.mode}${activeClass}"
                         style="width: ${pct}%"
                         data-seg-idx="${i}"
                         title="${this._fmtTime(seg.startTime)} → ${this._fmtTime(seg.endTime)} (${seg.mode})">${label}</div>`;
        }).join('');

        // Tick labels
        const ticks = new Set([0, this.endTime]);
        this.segments.forEach(s => { ticks.add(s.startTime); ticks.add(s.endTime); });
        const sortedTicks = [...ticks].sort((a, b) => a - b);

        // Only show first and last to keep it clean
        return `
            <div class="ts-timeline">
                <div class="ts-timeline-bar">${bars}</div>
                <div class="ts-timeline-labels">
                    <span>${this._fmtTime(0)}</span>
                    <span>${this._fmtTime(this.endTime)}</span>
                </div>
            </div>
        `;
    }

    _renderSegmentList() {
        return `
            <div class="ts-segments">
                ${this.segments.map((seg, i) => this._renderSegmentRow(seg, i)).join('')}
            </div>
        `;
    }

    _renderSegmentRow(seg, index) {
        const isFirst = index === 0;
        const isLast = index === this.segments.length - 1;
        const onlyOne = this.segments.length === 1;
        const activeClass = index === this.activeIndex ? ' active' : '';

        // Param input depends on mode
        const paramHtml = seg.mode === 'fixed'
            ? `<label>Δt</label>
               <input type="text" value="${seg.deltaT}" data-seg-idx="${index}" data-param="deltaT"
                      title="Fixed time step size">`
            : `<label>maxCo</label>
               <input type="text" value="${seg.maxCo}" data-seg-idx="${index}" data-param="maxCo"
                      title="Maximum Courant number">`;

        return `
            <div class="ts-segment-row${activeClass}" data-seg-idx="${index}">
                <div class="ts-seg-num mode-${seg.mode}">${index + 1}</div>
                <div class="ts-seg-time">
                    <input type="text" value="${seg.startTime}" ${isFirst ? 'disabled' : ''}
                           data-seg-idx="${index}" data-field="startTime" title="Start time">
                    <span class="ts-arrow">→</span>
                    <input type="text" value="${seg.endTime}" ${isLast ? 'disabled' : ''}
                           data-seg-idx="${index}" data-field="endTime" title="End time">
                </div>
                <div class="ts-seg-mode">
                    <select data-seg-idx="${index}">
                        <option value="fixed" ${seg.mode === 'fixed' ? 'selected' : ''}>Fixed</option>
                        <option value="adaptive" ${seg.mode === 'adaptive' ? 'selected' : ''}>Adaptive</option>
                    </select>
                </div>
                <div class="ts-seg-param">
                    ${paramHtml}
                </div>
                <button class="ts-seg-delete" data-seg-idx="${index}"
                        ${onlyOne ? 'disabled' : ''} title="Remove segment">✕</button>
            </div>
        `;
    }

    // ---- Events ----

    _attachEvents() {
        // Initial Delta T
        const initialDtInput = this.container.querySelector('#ts-initial-dt');
        if (initialDtInput) {
            initialDtInput.addEventListener('change', (e) => {
                const val = parseFloat(e.target.value);
                if (val > 0) {
                    this.initialDeltaT = val;
                    this._emitChange();
                }
            });
        }

        // Add segment
        const addBtn = this.container.querySelector('#ts-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this._addSegment());
        }

        // Click on timeline bar segment to select
        this.container.querySelectorAll('.ts-segment-bar').forEach(el => {
            el.addEventListener('click', () => {
                this.activeIndex = parseInt(el.dataset.segIdx);
                this._render();
            });
        });

        // Click on row to select
        this.container.querySelectorAll('.ts-segment-row').forEach(el => {
            el.addEventListener('click', (e) => {
                // Don't select if clicking on inputs/buttons/selects
                if (['INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName)) return;
                this.activeIndex = parseInt(el.dataset.segIdx);
                this._render();
            });
        });

        // Mode select changes
        this.container.querySelectorAll('.ts-seg-mode select').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.segIdx);
                this._updateSegmentMode(idx, e.target.value);
            });
        });

        // End time changes
        this.container.querySelectorAll('.ts-seg-time input[data-field="endTime"]').forEach(inp => {
            inp.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.segIdx);
                this._updateSegmentEndTime(idx, e.target.value);
            });
        });

        // Start time changes (for non-first segments)
        this.container.querySelectorAll('.ts-seg-time input[data-field="startTime"]:not([disabled])').forEach(inp => {
            inp.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.segIdx);
                const newStart = parseFloat(e.target.value);
                if (isNaN(newStart) || idx === 0) return;
                // This changes the previous segment's endTime
                this._updateSegmentEndTime(idx - 1, newStart);
            });
        });

        // Param changes (deltaT / maxCo)
        this.container.querySelectorAll('.ts-seg-param input').forEach(inp => {
            inp.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.segIdx);
                const param = e.target.dataset.param;
                this._updateSegmentParam(idx, param, e.target.value);
            });
        });

        // Delete buttons
        this.container.querySelectorAll('.ts-seg-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(e.target.closest('.ts-seg-delete').dataset.segIdx);
                this._removeSegment(idx);
            });
        });
    }

    _validate() {
        const el = this.container.querySelector('#ts-validation');
        if (!el) return true;

        const errors = [];

        // Check coverage
        if (this.segments.length === 0) {
            errors.push('At least one segment is required.');
        } else {
            if (this.segments[0].startTime !== 0) {
                errors.push('First segment must start at time 0.');
            }
            const last = this.segments[this.segments.length - 1];
            if (Math.abs(last.endTime - this.endTime) > 1e-12) {
                errors.push(`Last segment must end at ${this.endTime}.`);
            }
            // Check continuity
            for (let i = 1; i < this.segments.length; i++) {
                if (Math.abs(this.segments[i].startTime - this.segments[i - 1].endTime) > 1e-12) {
                    errors.push(`Gap between segment ${i} and ${i + 1}.`);
                }
            }
            // Check positive durations
            for (let i = 0; i < this.segments.length; i++) {
                if (this.segments[i].endTime <= this.segments[i].startTime) {
                    errors.push(`Segment ${i + 1} has zero or negative duration.`);
                }
            }
            // Check deltaT for fixed segments
            for (let i = 0; i < this.segments.length; i++) {
                if (this.segments[i].mode === 'fixed' && this.segments[i].deltaT <= 0) {
                    errors.push(`Segment ${i + 1}: deltaT must be positive.`);
                }
            }
        }

        if (errors.length) {
            el.className = 'ts-validation error';
            el.textContent = errors.join(' ');
            return false;
        } else {
            el.className = 'ts-validation valid';
            el.textContent = '';
            return true;
        }
    }
}

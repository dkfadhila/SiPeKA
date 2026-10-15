'use strict';
// The old harness expected enabled personal payroll routes. Those are now
// permanently inaccessible. Exercise the replacement real PostgreSQL fixture:
// nine financial PDF types, selected company/unit, CSV identity/coverage,
// Staff report denial, and payroll HTTP 410, with no provider calls.
require('./device-unit-vps.cjs');

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RAY_DEFINITIONS, type RayReading } from '@/lib/sensors';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronLeft, ChevronRight, CircleGauge } from 'lucide-react';
import type { VehicleTelemetry } from '@/lib/telemetry';

export function SensorDebug({ readings, vehicle, visible, onToggle, open, onOpenChange }: {
  readings: readonly RayReading[];
  vehicle: VehicleTelemetry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return <aside className={'debug-dock' + (open ? ' is-open' : '')} aria-label="Vehicle and sensor debug menu">
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="debug-fold" aria-label={open ? 'Collapse debug menu' : 'Expand debug menu'}>
        {open ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
        <span>{open ? 'Debug telemetry' : 'Debug'}</span>
        {open && <small>Collapse</small>}
      </CollapsibleTrigger>
      <CollapsibleContent className="debug-content">
      <section className="sensor-debug" aria-labelledby="vehicle-heading">
        <div className="sensor-header"><div><span className="eyebrow">VEHICLE DEBUG</span><h3 id="vehicle-heading">Controls & position</h3></div></div>
        <div className="pedal-readings">
          <label>Accelerator <strong>{vehicle.accelerator * 100}%</strong><meter min={0} max={1} value={vehicle.accelerator} aria-label="Accelerator position"/></label>
          <label>Brake / reverse <strong>{vehicle.brake * 100}%</strong><meter min={0} max={1} value={vehicle.brake} aria-label="Brake position"/></label>
        </div>
        <dl className="vehicle-readings">
          <div><dt>Position X</dt><dd>{vehicle.position.x.toFixed(2)}</dd></div>
          <div><dt>Position Z</dt><dd>{vehicle.position.z.toFixed(2)}</dd></div>
          <div><dt>Car heading</dt><dd>{vehicle.headingDegrees.toFixed(1)}°</dd></div>
          <div><dt>Steering input</dt><dd>{vehicle.steering > 0 ? '+' : ''}{vehicle.steering.toFixed(2)}</dd></div>
        </dl>
        <div className="steering-reading"><CircleGauge size={38} aria-hidden="true" style={{transform:'rotate(' + vehicle.steeringWheelAngle + 'deg)'}}/><div><span>Steering wheel</span><strong>{vehicle.steeringWheelAngle > 0 ? '+' : ''}{vehicle.steeringWheelAngle.toFixed(0)}° <small>{vehicle.steering < 0 ? 'Left' : vehicle.steering > 0 ? 'Right' : 'Centered'}</small></strong></div></div>
        <p className="sensor-note">Keyboard pedals are 0% or 100%. Steering ramps almost linearly to ±90° over 0.35 seconds; release returns it to center. Heading is clockwise from +X; position uses world X/Z units.</p>
      </section>
      <section className="sensor-debug" aria-labelledby="sensor-heading">
    <header className="sensor-header">
      <div><span className="eyebrow">SENSOR DEBUG</span><h3 id="sensor-heading">Road-edge distances</h3></div>
      <Button variant="outline" aria-pressed={visible} onClick={onToggle}>
        {visible ? 'Hide rays' : 'Show rays'}
      </Button>
    </header>
    <p>9 front rays · 3 rear rays. Distances start at the bumpers and stop at the first asphalt edge. Units are game-world units.</p>
    <div className="sensor-legend">
      <span className="sensor-front">Lime: front</span><span className="sensor-rear">Blue: rear</span>
      <span>White dot: hit</span><span>Gray dot: range limit</span><span>Dashed: unused range</span>
    </div>
    <Table className="sensor-table">
      <TableHeader><TableRow>
        <TableHead scope="col">Ray</TableHead><TableHead scope="col">Angle</TableHead>
        <TableHead scope="col">Distance</TableHead><TableHead scope="col">Range</TableHead>
        <TableHead scope="col" title="Distance divided by maximum range">Ratio</TableHead><TableHead scope="col">Result</TableHead>
      </TableRow></TableHeader>
      <TableBody>{RAY_DEFINITIONS.map((definition, index) => {
        const ray = readings[index];
        return <TableRow key={definition.id} className={definition.bank === 'rear' ? 'sensor-rear-row' : ''}>
          <TableHead scope="row" className={definition.bank === 'front' ? 'sensor-front' : 'sensor-rear'}>{definition.id}</TableHead>
          <TableCell>{definition.angleDeg > 0 ? '+' : ''}{definition.angleDeg}°</TableCell>
          <TableCell>{ray ? ray.distance.toFixed(2) : '—'}</TableCell>
          <TableCell>{definition.maxRange.toFixed(2)}</TableCell>
          <TableCell><span className="sensor-normalized">{ray ? ray.normalizedDistance.toFixed(3) : '—'}<span className="sensor-bar" aria-hidden="true"><span style={{ width: `${(ray?.normalizedDistance ?? 0) * 100}%` }}/></span></span></TableCell>
          <TableCell>{ray ? ray.hit ? 'Edge hit' : 'No hit' : 'Waiting'}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
    <p className="sensor-note">0° points forward; negative angles point left. No hit returns the maximum range and a normalized value of 1. A hit exactly at the limit also reads 1; the result distinguishes it.</p>
      </section>
      </CollapsibleContent>
    </Collapsible>
  </aside>;
}

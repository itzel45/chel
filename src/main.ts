import { Component, OnInit, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

type Ticket = { id: string; number: string; kind: string; status: string; desk: number|null; created_at: string; called_at?: string };
type Desk = { number: number; current: Ticket|null };
type Snapshot = { tickets: Ticket[]; desks: Desk[]; waiting: number; served: number };

@Component({ selector: 'app-root', standalone: true, template: `
  <header class="topbar"><div class="brand"><span class="brand-mark">B</span><span>BBVA <small>ATENCIÓN</small></span></div><div class="top-status"><span class="live-dot"></span> Sistema en línea <span class="divider"></span>{{ now }}</div></header>
  <main class="shell">
    <section class="welcome"><div><p class="eyebrow">CENTRO DE ATENCIÓN</p><h1>Turnos y ventanillas</h1><p class="muted">Administra la fila y brinda una atención más ágil.</p></div><button class="refresh" (click)="load()" aria-label="Actualizar">↻ <span>Actualizar</span></button></section>
    @if (error()) { <div class="notice">{{ error() }}</div> }
    <section class="metrics"><article class="metric"><span class="metric-icon blue">◷</span><div><span class="metric-label">En espera</span><strong>{{ data()?.waiting ?? 0 }}</strong></div><span class="metric-note">personas</span></article><article class="metric"><span class="metric-icon green">✓</span><div><span class="metric-label">Atendidos hoy</span><strong>{{ data()?.served ?? 0 }}</strong></div><span class="metric-note">turnos</span></article><article class="metric"><span class="metric-icon slate">▦</span><div><span class="metric-label">Ventanillas activas</span><strong>4</strong></div><span class="metric-note">disponibles</span></article></section>
    <section class="desk-heading"><div><h2>Ventanillas</h2><p class="muted">Llama al siguiente turno disponible.</p></div><div class="key"><span class="live-dot"></span> En servicio</div></section>
    <section class="desks">@for (desk of data()?.desks ?? []; track desk.number) { <article class="desk-card"><div class="desk-top"><div><span class="desk-label">VENTANILLA</span><h3>{{ desk.number }}</h3></div><span class="desk-state" [class.busy]="!!desk.current">{{ desk.current ? 'En servicio' : 'Disponible' }}</span></div><div class="current-ticket">@if (desk.current) { <span class="ticket-caption">Turno actual</span><strong>{{ desk.current.number }}</strong><span class="ticket-kind">{{ desk.current.kind }}</span> } @else { <span class="empty-icon">◷</span><span class="empty-copy">Lista para atender</span> }</div><div class="desk-actions"><button class="btn-primary" [disabled]="!!desk.current || busy()" (click)="callNext(desk.number)">{{ desk.current ? 'Atendiendo…' : 'Llamar siguiente' }} <span>→</span></button>@if (desk.current) { <button class="btn-finish" [disabled]="busy()" (click)="finish(desk.number)">Finalizar atención</button> }</div></article> }</section>
    <section class="lower"><article class="panel issue"><div class="panel-title"><div><h2>Asignar turno</h2><p class="muted">Registra a la siguiente persona en la fila.</p></div><span class="issue-icon">＋</span></div><label for="service">Tipo de atención</label><select id="service" [value]="kind()" (change)="setKind($event)"><option>Atención general</option><option>Caja</option><option>Ejecutivo</option><option>Preferente</option></select><button class="btn-primary issue-btn" [disabled]="busy()" (click)="createTicket()">Generar turno <span>→</span></button><div class="hint">El turno se asignará al primer asesor disponible.</div></article>
    <article class="panel queue"><div class="panel-title"><div><h2>Próximos turnos</h2><p class="muted">Personas esperando atención</p></div><span class="queue-count">{{ data()?.waiting ?? 0 }} en fila</span></div><div class="queue-list">@for (ticket of waitingTickets(); track ticket.id) { <div class="queue-row"><span class="queue-number">{{ ticket.number }}</span><span class="queue-service">{{ ticket.kind }}</span><span class="queue-time">{{ time(ticket.created_at) }}</span></div> } @if (waitingTickets().length === 0) { <div class="queue-empty">No hay personas en espera.</div> }</div></article></section>
    <footer>Panel de atención <span>•</span> Los turnos se actualizan automáticamente cada 5 segundos</footer>
  </main>` })
class App implements OnInit {
  data = signal<Snapshot|null>(null); error = signal(''); busy = signal(false); kind = signal('Atención general'); now = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
  constructor(private http: HttpClient) {}
  ngOnInit() { this.load(); setInterval(() => this.load(), 5000); setInterval(() => this.now = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}), 30000); }
  waitingTickets() { return (this.data()?.tickets ?? []).filter(t => t.status === 'waiting').sort((a,b)=>a.created_at.localeCompare(b.created_at)); }
  setKind(e: Event) { this.kind.set((e.target as HTMLSelectElement).value); }
  time(value: string) { return new Date(value).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}); }
  async load() { try { const result = await firstValueFrom(this.http.get<Snapshot>('/api/state')); this.data.set(result); this.error.set(''); } catch { this.error.set('No se pudo conectar con el servicio. Revisa que la API esté desplegada.'); } }
  async action(path: string, body: object) { this.busy.set(true); this.error.set(''); try { await firstValueFrom(this.http.post('/api/'+path,body)); await this.load(); } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo completar la acción.'); } finally { this.busy.set(false); } }
  createTicket() { this.action('tickets',{kind:this.kind()}); }
  callNext(desk: number) { this.action('call',{desk}); }
  finish(desk: number) { this.action('finish',{desk}); }
}
bootstrapApplication(App,{providers:[provideHttpClient()]}).catch(console.error);

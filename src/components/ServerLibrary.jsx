import React, { useState } from 'react';
import { Plus, X, ArrowUpRight, Trash2, Search, Star } from 'lucide-react';
import ServerAvatar from './ServerAvatar';

export default function ServerLibrary({ servers, activeId, onSelect, onRemove, onToggleFavorite, onAdd, onClose, onRequestConfirm }) {
  const [filter, setFilter] = useState('ทั้งหมด');
  const [search, setSearch] = useState('');

  const shown = servers.filter(s => {
    const matchesFilter =
      filter === 'ทั้งหมด' ||
      (filter === 'เมืองโปรด' ? !!s.favorite : s.tag === filter);
    const matchesSearch = (s.name + ' ' + s.ip).toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-dialog library-dialog" role="dialog" aria-modal="true" aria-label="เมืองของฉัน" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">YOUR COLLECTION</span>
            <h2>เมืองของฉัน <small>{servers.length}</small></h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="ปิด">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <div className="library-toolbar">
            <label className="search-field">
              <Search size={17} />
              <input
                aria-label="ค้นหาเมือง"
                placeholder="ค้นหาชื่อเมืองหรือที่อยู่…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </label>
            <button className="soft-button" onClick={onAdd}>
              <Plus size={16} /> เพิ่มเมือง
            </button>
          </div>
          <div className="sidebar-filters">
            {['ทั้งหมด', 'เมืองโปรด', 'Roleplay', 'Training', 'ไม่มี'].map(tag => (
              <button
                key={tag}
                className={`filter-tab ${filter === tag ? 'active' : ''}`}
                aria-pressed={filter === tag}
                onClick={() => setFilter(tag)}
              >
                {tag === 'เมืองโปรด' ? '★ เมืองโปรด' : tag}
              </button>
            ))}
          </div>
          <div className="server-list">
            {!shown.length && <p className="empty-library">ไม่มีเซิร์ฟเวอร์ในหมวดนี้</p>}
            {shown.map(s => (
              <div className={`server-card ${s.id === activeId ? 'active' : ''}`} key={s.id}>
                <button className="library-select" onClick={() => onSelect(s.id)}>
                  <ServerAvatar server={s} />
                  <span>
                    <strong>{s.name}</strong>
                    <small>
                      {s.tag || 'ไม่มี'} · {s.ip} · {['Online', 'Offline'].includes(s.status) ? s.status : 'ยังไม่ทราบสถานะ'}
                    </small>
                  </span>
                  <ArrowUpRight size={18} />
                </button>
                {onToggleFavorite && (
                  <button
                    type="button"
                    className={`server-card-star${s.favorite ? ' active' : ''}`}
                    aria-label={s.favorite ? `เลิกปักหมุด ${s.name}` : `ปักหมุด ${s.name} เป็นเมืองโปรด`}
                    aria-pressed={!!s.favorite}
                    onClick={() => onToggleFavorite(s)}
                  >
                    <Star size={15} fill={s.favorite ? 'currentColor' : 'none'} />
                  </button>
                )}
                  <button
                    className="server-card-remove"
                    aria-label={`ลบ ${s.name}`}
                    onClick={() => {
                      if (onRequestConfirm) {
                        onRequestConfirm({
                          title: 'ลบรายการเมือง',
                          message: `ต้องการลบ "${s.name}" ออกจากรายการเมืองใช่หรือไม่?`,
                          detail: 'คุณสามารถเพิ่มเซิร์ฟเวอร์กลับเข้ามาใหม่ได้ตลอดเวลา',
                          confirmLabel: 'ลบเมือง',
                          tone: 'danger',
                          onConfirm: () => onRemove(s.id)
                        });
                      } else {
                        onRemove(s.id);
                      }
                    }}
                  >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <p className="help-text">รูปประจำเมืองมาจากไอคอนที่เซิร์ฟเวอร์ส่งให้ หากอ่านไม่ได้จะแสดงอักษรย่อ</p>
        </div>
      </section>
    </div>
  );
}

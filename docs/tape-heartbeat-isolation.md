# Tape heartbeat isolation

Цель: убрать секундный микрофриз только внутри Tape.

- секундный heartbeat не сканирует весь document;
- heartbeat не вызывает Canvas draw, layout rebuild или density decoration;
- карточки регистрируются через существующий MutationObserver;
- age-подписи плотностей обновляются только когда режим «ВРЕМЯ» включён;
- графики, стакан, Footprint, Worker, WebSocket и глобальные scheduler-ы не меняются.

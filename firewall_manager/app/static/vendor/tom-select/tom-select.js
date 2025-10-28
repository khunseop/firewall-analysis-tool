(function(){
  function TomSelect(selectEl, opts){
    this.select = selectEl;
    this.opts = opts || {};
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'ts-control';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = this.opts.placeholder || '';
    this.wrapper.tabIndex = 0;
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'ts-dropdown';
    this.dropdown.style.display = 'none';

    // Hide original select
    selectEl.style.display = 'none';
    selectEl.parentNode.insertBefore(this.wrapper, selectEl);
    this.wrapper.appendChild(this.input);
    this.wrapper.appendChild(this.dropdown);

    // Populate options
    this.options = Array.from(selectEl.options).map(function(opt){
      return { value: opt.value, text: opt.text };
    });

    this.bind();
  }
  TomSelect.prototype.bind = function(){
    var self = this;
    self.input.addEventListener('input', function(){ self.render(self.input.value); });
    self.wrapper.addEventListener('click', function(){ self.toggle(true); self.render(self.input.value); self.input.focus(); });
    self.input.addEventListener('keydown', function(e){
      if (e.key === 'ArrowDown') { self.move(1); e.preventDefault(); }
      if (e.key === 'ArrowUp') { self.move(-1); e.preventDefault(); }
      if (e.key === 'Enter') { self.selectActive(); e.preventDefault(); }
      if (e.key === 'Escape') { self.toggle(false); }
    });
    document.addEventListener('click', function(e){ if (!self.wrapper.contains(e.target)) self.toggle(false); });
  };
  TomSelect.prototype.toggle = function(open){ this.dropdown.style.display = open ? 'block' : 'none'; };
  TomSelect.prototype.render = function(query){
    var self = this;
    var q = (query||'').toLowerCase();
    var list = self.options.filter(function(o){ return !q || o.text.toLowerCase().indexOf(q) !== -1; });
    self.dropdown.innerHTML = '';
    list.forEach(function(o, idx){
      var div = document.createElement('div');
      div.className = 'option' + (idx===0 ? ' active' : '');
      div.textContent = o.text;
      div.dataset.value = o.value;
      div.addEventListener('mousemove', function(){ self.activate(div); });
      div.addEventListener('click', function(){ self.choose(o.value); });
      self.dropdown.appendChild(div);
    });
    self.toggle(list.length>0);
  };
  TomSelect.prototype.activate = function(el){
    Array.from(this.dropdown.querySelectorAll('.option')).forEach(function(n){ n.classList.remove('active'); });
    if (el) el.classList.add('active');
  };
  TomSelect.prototype.move = function(delta){
    var all = Array.from(this.dropdown.querySelectorAll('.option'));
    if (!all.length) return;
    var cur = this.dropdown.querySelector('.option.active');
    var idx = all.indexOf(cur);
    var next = all[(idx + delta + all.length) % all.length];
    this.activate(next);
  };
  TomSelect.prototype.selectActive = function(){
    var el = this.dropdown.querySelector('.option.active');
    if (el) this.choose(el.dataset.value);
  };
  TomSelect.prototype.choose = function(value){
    var opt = Array.from(this.select.options).find(function(o){ return o.value==value; });
    if (opt) {
      this.select.value = opt.value;
      this.input.value = opt.text;
      var event = new Event('change', { bubbles: true });
      this.select.dispatchEvent(event);
    }
    this.toggle(false);
  };
  TomSelect.prototype.destroy = function(){
    this.wrapper.remove();
    this.select.style.display = '';
  };
  window.TomSelect = TomSelect;
})();

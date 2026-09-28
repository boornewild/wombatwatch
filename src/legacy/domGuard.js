/* ── DOM guard: prevent React removeChild/insertBefore crashes ──────────────
   Browser features (iOS autocorrect, Chrome spellcheck, Android autocomplete,
   browser-extension overlays, Chrome Translate) occasionally inject or move DOM
   nodes that React then tries to remove — causing an uncaught NotFoundError that
   tears down the entire app.  We patch the two DOM methods React uses so that if
   the node is no longer where React expects it, we silently no-op rather than
   crash.  The visual effect is negligible: the node is already not where React
   thought it was, so the DOM was already inconsistent.                          */
(function(){
  const _rc=Node.prototype.removeChild;
  Node.prototype.removeChild=function(child){
    if(child.parentNode!==this){
      console.warn('[WW] removeChild skipped — node not a child (browser modified DOM)');
      return child;
    }
    return _rc.call(this,child);
  };
  const _ib=Node.prototype.insertBefore;
  Node.prototype.insertBefore=function(node,ref){
    if(ref&&ref.parentNode!==this){
      console.warn('[WW] insertBefore: ref not a child — appending instead');
      return _ib.call(this,node,null);
    }
    return _ib.call(this,node,ref);
  };
})();

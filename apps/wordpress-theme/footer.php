<?php
/**
 * USSALMC Theme — app shell footer: closes .main / .app, runs wp_footer.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
	</div><!-- .main -->
</div><!-- .app -->

<script>
/* live-feeling clock in the sync-status line, matching corp-portal.html */
(function(){
  function pad(n){ return n.toString().padStart(2,'0'); }
  function tick(){
    var el = document.getElementById('ussa-clock');
    if(!el) return;
    var d = new Date();
    el.textContent = pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds())+' UTC';
  }
  tick(); setInterval(tick, 1000);
  /* rail active-state on click (visual only; hrefs still navigate) */
  document.querySelectorAll('.rail-item').forEach(function(item){
    item.addEventListener('click', function(){
      document.querySelectorAll('.rail-item').forEach(function(i){ i.classList.remove('active'); });
      item.classList.add('active');
    });
  });
})();
</script>
<?php wp_footer(); ?>
</body>
</html>

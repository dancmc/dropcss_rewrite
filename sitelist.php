<?php
/**
 * Plugin Name: PageList
 * Plugin URI: 
 * Description: Plugin to write list of wordpress pages to a file
 * Version: 1.0
 * Author: Dancmc
 * Author URI: 
 */

register_activation_hook('/var/www/basc/wp-content/plugins/sitelist/sitelist.php', 'my_activation');

function gen_sitelist() {
	error_log("gen");
	$pages = get_pages(); 
	$fp = fopen('/var/www/basc/sitelist.txt', 'w');
	foreach ( $pages as $page ) {
    fwrite($fp, get_page_link( $page->ID ) . "\n");
  	}
  	$posts = get_posts(); 
  	foreach ( $posts as $post ) {
    fwrite($fp, get_permalink( $post ) . "\n");
  	}
  	fclose($fp);
}

add_action('regenerate_sitelist', 'gen_sitelist');

function my_activation() {
    if (! wp_next_scheduled ( 'regenerate_sitelist' )) {
    	error_log("scheduling");
	wp_schedule_event(time()+2000, 'hourly', 'regenerate_sitelist');
    }
    error_log("sss");
}





register_deactivation_hook('/var/www/basc/wp-content/plugins/sitelist/sitelist.php', 'my_deactivation');

function my_deactivation() {
	wp_clear_scheduled_hook('regenerate_sitelist');
}

?>
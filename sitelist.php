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

function gen_sitelist($trigger) {
	error_log("gen_sitelist");


	$fp = fopen('/var/www/basc/sitelist.txt', 'w');


    $pages = get_pages();
    foreach ( $pages as $page ) {
        $page_id = $page->ID;
        $page_edited = ($trigger == $page_id) ? 'true' : 'false';
        fwrite($fp, get_page_link( $page_id ) . "\t" . $page_edited . "\n");
  	}
  	$posts = get_posts(); 
  	foreach ( $posts as $post ) {
        $post_id = $post->ID;
        $post_edited = ($trigger == $post_id) ? 'true' : 'false';
        fwrite($fp, get_permalink( $post_id ) . "\t" . $post_edited . "\n");
  	}

  	fclose($fp);
}

add_action('regenerate_sitelist', 'gen_sitelist');
add_action( 'save_post', 'gen_sitelist' );

function my_activation() {
    if (! wp_next_scheduled ( 'regenerate_sitelist' )) {
    	error_log("scheduling");
	wp_schedule_event(time(), 'hourly', 'regenerate_sitelist', array(null));
    }

    error_log("sss");
}




register_deactivation_hook('/var/www/basc/wp-content/plugins/sitelist/sitelist.php', 'my_deactivation');

function my_deactivation() {
	wp_clear_scheduled_hook('regenerate_sitelist');
}

?>
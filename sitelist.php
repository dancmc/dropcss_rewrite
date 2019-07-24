<?php
/**
 * Plugin Name: PageList
 * Plugin URI: 
 * Description: Plugin to write list of wordpress pages to a file
 * Version: 1.0
 * Author: Dancmc
 * Author URI: 
 */


// Objective is to generate JSON :
// Array
    // Object
        // url : url
        // type : post or page
        // edited : bool
        // category : ""

function gen_sitelist($trigger) {
	error_log("gen_sitelist");

	$jsonArray = [];


    $pages = get_pages();
    foreach ( $pages as $page ) {
        if($page->post_status=="publish"){
            $page_id = $page->ID;

            $jsonPage = new stdClass();
            $jsonPage->url = get_page_link( $page_id );
            $jsonPage->type = "page";
            $jsonPage->edited = ($trigger == $page_id) ? 'true' : 'false';

            array_push($jsonArray, $jsonPage);
        }
  	}
  	$posts = get_posts(); 
  	foreach ( $posts as $post ) {
  	    if($post->post_status=="publish") {
            $post_id = $post->ID;

            $jsonPost = new stdClass();
            $jsonPost->url = get_permalink($post_id);
            $jsonPost->type = "post";
            $jsonPost->title = $post->post_title;
            $jsonPost->edited = ($trigger == $post_id) ? 'true' : 'false';
            $categories = get_the_category($post_id);
            $num_categories = sizeof($categories);
            $jsonPost->category = ($num_categories > 0) ? $categories[0]->slug : "none";
            $jsonPost->date = $post->post_date;

            array_push($jsonArray, $jsonPost);
        }
  	}

    $fp = fopen('/var/www/basc/sitelist.txt', 'w');
  	fwrite($fp,  json_encode($jsonArray));
  	fclose($fp);
}



function my_activation() {
    if (! wp_next_scheduled ( 'regenerate_sitelist' )) {
    	error_log("scheduling");
	wp_schedule_event(time(), 'hourly', 'regenerate_sitelist', array(null));
    }

    error_log("sss");
}

function my_deactivation() {
    wp_clear_scheduled_hook('regenerate_sitelist');
}


register_activation_hook('/var/www/basc/wp-content/plugins/sitelist/sitelist.php', 'my_activation');
add_action('regenerate_sitelist', 'gen_sitelist');
add_action( 'save_post', 'gen_sitelist' );
register_deactivation_hook('/var/www/basc/wp-content/plugins/sitelist/sitelist.php', 'my_deactivation');






?>
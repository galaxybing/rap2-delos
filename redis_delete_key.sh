redis_list=("172.16.150.152:7000" "172.16.150.152:7001" "172.16.150.152:7002")
password="HJUoGpaY-C81"

for info in ${redis_list[@]}
    do
        echo "开始执行:$info"  
        ip=`echo $info | cut -d : -f 1`
        port=`echo $info | cut -d : -f 2`
        cat key.txt |xargs -t -n1 redis-cli -h $ip -p $port -a $password -c del
    done
    echo "完成"